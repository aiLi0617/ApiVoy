use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, RequestEnvelope,
    ResponseMeta,
};
use event_stream::EventSink;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, instrument};

use crate::{
    apply_auth, run_assertions, AssertionContext, DriverError, EngineError, LifecycleHook,
    LifecyclePhase, NoopLifecycleHook, ProtocolDriver, VariableScope,
};
use crate::variables::resolve_request;

pub struct ExecutionEngine {
    drivers: HashMap<String, Arc<dyn ProtocolDriver>>,
    lifecycle: Arc<dyn LifecycleHook>,
    active: Arc<Mutex<HashMap<ExecutionId, CancellationToken>>>,
}

impl ExecutionEngine {
    pub fn new() -> Self {
        Self {
            drivers: HashMap::new(),
            lifecycle: Arc::new(NoopLifecycleHook),
            active: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Replace the lifecycle hook (P1 scripts / observers).
    pub fn set_lifecycle_hook(&mut self, hook: Arc<dyn LifecycleHook>) {
        self.lifecycle = hook;
    }

    pub fn register(&mut self, driver: Arc<dyn ProtocolDriver>) {
        let id = driver.descriptor().protocol_id;
        info!(protocol_id = %id, "registered protocol driver");
        self.drivers.insert(id, driver);
    }

    pub fn list_drivers(&self) -> Vec<crate::DriverDescriptor> {
        self.drivers.values().map(|d| d.descriptor()).collect()
    }

    /// Cancel an in-flight execution. Returns `true` if a token was found and cancelled.
    pub fn cancel(&self, id: &ExecutionId) -> bool {
        let guard = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(token) = guard.get(id) {
            token.cancel();
            true
        } else {
            false
        }
    }

    #[instrument(skip(self, request), fields(protocol = %request.protocol_id.0, request = %request.id.0))]
    pub async fn execute(
        &self,
        request: RequestEnvelope,
    ) -> Result<
        (
            ExecutionId,
            mpsc::Receiver<ExecutionEvent>,
            tokio::task::JoinHandle<Result<ExecutionSummary, EngineError>>,
        ),
        EngineError,
    > {
        self.execute_with_scope(request, VariableScope::default())
            .await
    }

    #[instrument(skip(self, request, scope), fields(protocol = %request.protocol_id.0, request = %request.id.0))]
    pub async fn execute_with_scope(
        &self,
        request: RequestEnvelope,
        scope: VariableScope,
    ) -> Result<
        (
            ExecutionId,
            mpsc::Receiver<ExecutionEvent>,
            tokio::task::JoinHandle<Result<ExecutionSummary, EngineError>>,
        ),
        EngineError,
    > {
        let protocol = request.protocol_id.0.clone();
        let driver = self
            .drivers
            .get(&protocol)
            .cloned()
            .ok_or_else(|| EngineError::DriverNotFound(protocol))?;

        // Validate after variable resolution inside `run_driver` so `{{baseUrl}}`
        // templates are not rejected before substitution.

        let execution_id = ExecutionId::new();
        let (sink, rx) = EventSink::channel();
        let cancel = CancellationToken::new();
        let cancel_child = cancel.child_token();
        let lifecycle = Arc::clone(&self.lifecycle);
        let active = Arc::clone(&self.active);

        {
            let mut guard = active.lock().unwrap_or_else(|e| e.into_inner());
            guard.insert(execution_id, cancel);
        }

        let handle = tokio::spawn(async move {
            let result = run_driver(
                driver,
                request,
                scope,
                sink,
                cancel_child,
                execution_id,
                lifecycle,
            )
            .await;

            {
                let mut guard = active.lock().unwrap_or_else(|e| e.into_inner());
                guard.remove(&execution_id);
            }

            result
        });

        Ok((execution_id, rx, handle))
    }

    /// Convenience helper for scaffolding / CLI: run to completion and collect events.
    pub async fn execute_collect(
        &self,
        request: RequestEnvelope,
    ) -> Result<(ExecutionId, ExecutionSummary, Vec<ExecutionEvent>), EngineError> {
        self.execute_collect_with_scope(request, VariableScope::default())
            .await
    }

    pub async fn execute_collect_with_scope(
        &self,
        request: RequestEnvelope,
        scope: VariableScope,
    ) -> Result<(ExecutionId, ExecutionSummary, Vec<ExecutionEvent>), EngineError> {
        let (id, mut rx, handle) = self.execute_with_scope(request, scope).await?;
        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        let summary = handle
            .await
            .map_err(|e| EngineError::Driver(DriverError::Internal(e.to_string())))??;
        Ok((id, summary, events))
    }
}

async fn run_driver(
    driver: Arc<dyn ProtocolDriver>,
    request: RequestEnvelope,
    scope: VariableScope,
    mut sink: EventSink,
    cancel_child: CancellationToken,
    execution_id: ExecutionId,
    lifecycle: Arc<dyn LifecycleHook>,
) -> Result<ExecutionSummary, EngineError> {
    lifecycle.on_phase(LifecyclePhase::BeforeRequest).await;

    sink.emit(ExecutionEvent::StateChanged {
        state: ExecutionState::Running,
        phase: Some(ExecutionPhase::Resolve),
    })
    .await;

    lifecycle.on_phase(LifecyclePhase::ResolveVariables).await;
    let request = match resolve_request(request, &scope) {
        Ok(req) => req,
        Err(err) => {
            sink.emit(ExecutionEvent::Failed {
                code: EngineError::Resolve(err.clone()).code().into(),
                message: err.to_string(),
            })
            .await;
            sink.emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Failed,
                phase: Some(ExecutionPhase::Resolve),
            })
            .await;
            drop(sink);
            return Err(EngineError::Resolve(err));
        }
    };

    let request = match apply_auth(request, &scope) {
        Ok(req) => req,
        Err(err) => {
            sink.emit(ExecutionEvent::Failed {
                code: err.code().into(),
                message: err.to_string(),
            })
            .await;
            sink.emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Failed,
                phase: Some(ExecutionPhase::Resolve),
            })
            .await;
            drop(sink);
            return Err(EngineError::Auth(err));
        }
    };

    lifecycle.on_phase(LifecyclePhase::BuildRequest).await;

    sink.emit(ExecutionEvent::StateChanged {
        state: ExecutionState::Running,
        phase: Some(ExecutionPhase::Validate),
    })
    .await;

    let report = driver.validate(&request);
    if !report.is_valid() {
        let message = report.errors.join("; ");
        sink.emit(ExecutionEvent::Failed {
            code: crate::ErrorKind::Validation.as_str().into(),
            message: message.clone(),
        })
        .await;
        sink.emit(ExecutionEvent::StateChanged {
            state: ExecutionState::Failed,
            phase: Some(ExecutionPhase::Validate),
        })
        .await;
        drop(sink);
        return Err(EngineError::Driver(DriverError::Validation(message)));
    }

    lifecycle.on_phase(LifecyclePhase::SendRequest).await;

    // Tee driver events so we can run assertions against response meta/body.
    let (tee_sink, mut tee_rx) = EventSink::channel();
    let mut outer = sink;
    let forward = tokio::spawn(async move {
        let mut meta: Option<ResponseMeta> = None;
        let mut body = String::new();
        while let Some(event) = tee_rx.recv().await {
            match &event {
                ExecutionEvent::ResponseMeta(m) => meta = Some(m.clone()),
                ExecutionEvent::ResponseChunk {
                    preview: Some(p),
                    done: true,
                    ..
                } => body = p.clone(),
                _ => {}
            }
            outer.emit(event).await;
        }
        (outer, meta, body)
    });

    match driver
        .execute(request.clone(), tee_sink, cancel_child, execution_id)
        .await
    {
        Ok(summary) => {
            let (mut sink, meta, body) = forward
                .await
                .map_err(|e| EngineError::Driver(DriverError::Internal(e.to_string())))?;

            lifecycle.on_phase(LifecyclePhase::ReceiveComplete).await;
            lifecycle.on_phase(LifecyclePhase::RunAssertions).await;

            if !request.assertions.is_empty() {
                sink.emit(ExecutionEvent::StateChanged {
                    state: ExecutionState::Running,
                    phase: Some(ExecutionPhase::Assert),
                })
                .await;

                let ctx = AssertionContext {
                    status: summary.status.or_else(|| meta.as_ref().and_then(|m| m.status)),
                    headers: meta
                        .as_ref()
                        .map(|m| m.headers.clone())
                        .unwrap_or_default(),
                    body,
                    duration_ms: summary.duration_ms,
                    bytes_received: summary.bytes_received,
                };
                for result in run_assertions(&request.assertions, &ctx) {
                    sink.emit(ExecutionEvent::AssertionResult(result)).await;
                }
            }

            lifecycle.on_phase(LifecyclePhase::ExtractVariables).await;
            lifecycle.on_phase(LifecyclePhase::AfterResponse).await;
            debug_assert_eq!(summary.execution_id.0, execution_id.0);
            drop(sink);
            Ok(summary)
        }
        Err(DriverError::Cancelled) => {
            let _ = forward.await;
            Err(EngineError::Cancelled)
        }
        Err(err) => {
            let (mut sink, _, _) = forward
                .await
                .map_err(|e| EngineError::Driver(DriverError::Internal(e.to_string())))?;
            let code = err.code().to_string();
            let message = err.message();
            sink.emit(ExecutionEvent::Failed { code, message })
                .await;
            sink.emit(ExecutionEvent::StateChanged {
                state: ExecutionState::Failed,
                phase: None,
            })
            .await;
            drop(sink);
            Err(EngineError::Driver(err))
        }
    }
}

impl Default for ExecutionEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Build a minimal HTTP GET envelope for smoke tests.
pub fn sample_http_get(url: impl Into<String>) -> RequestEnvelope {
    RequestEnvelope::http_get("Sample GET", url)
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use chrono::Utc;
    use core_domain::{Assertion, RequestId};
    use std::time::Duration;
    use tokio::sync::oneshot;

    struct MockOkDriver;

    #[async_trait]
    impl ProtocolDriver for MockOkDriver {
        fn descriptor(&self) -> crate::DriverDescriptor {
            crate::DriverDescriptor {
                protocol_id: "mock".into(),
                version: "0.0.0".into(),
                display_name: "Mock".into(),
                capabilities: vec![],
            }
        }

        fn validate(&self, _request: &RequestEnvelope) -> crate::ValidationReport {
            crate::ValidationReport::ok()
        }

        async fn execute(
            &self,
            request: RequestEnvelope,
            mut events: EventSink,
            _cancel: CancellationToken,
            execution_id: ExecutionId,
        ) -> Result<ExecutionSummary, DriverError> {
            events
                .emit(ExecutionEvent::ResponseMeta(ResponseMeta {
                    status: Some(200),
                    status_text: Some("OK".into()),
                    headers: vec![("x-test".into(), "1".into())],
                    content_type: Some("text/plain".into()),
                    size_hint: Some(2),
                }))
                .await;
            events
                .emit(ExecutionEvent::ResponseChunk {
                    content_type: Some("text/plain".into()),
                    size: 2,
                    preview: Some("ok".into()),
                    done: true,
                })
                .await;
            let summary = ExecutionSummary {
                execution_id,
                request_id: request.id.0,
                protocol_id: "mock".into(),
                state: ExecutionState::Completed,
                started_at: Utc::now(),
                finished_at: Utc::now(),
                duration_ms: 1,
                bytes_received: 2,
                status: Some(200),
            };
            events
                .emit(ExecutionEvent::Completed {
                    summary: summary.clone(),
                })
                .await;
            Ok(summary)
        }
    }

    struct MockTimeoutDriver;

    #[async_trait]
    impl ProtocolDriver for MockTimeoutDriver {
        fn descriptor(&self) -> crate::DriverDescriptor {
            crate::DriverDescriptor {
                protocol_id: "mock".into(),
                version: "0.0.0".into(),
                display_name: "Mock Timeout".into(),
                capabilities: vec![],
            }
        }

        fn validate(&self, _request: &RequestEnvelope) -> crate::ValidationReport {
            crate::ValidationReport::ok()
        }

        async fn execute(
            &self,
            _request: RequestEnvelope,
            _events: EventSink,
            _cancel: CancellationToken,
            _execution_id: ExecutionId,
        ) -> Result<ExecutionSummary, DriverError> {
            Err(DriverError::Timeout("mock timed out".into()))
        }
    }

    struct MockCancelDriver {
        started: Mutex<Option<oneshot::Sender<()>>>,
    }

    #[async_trait]
    impl ProtocolDriver for MockCancelDriver {
        fn descriptor(&self) -> crate::DriverDescriptor {
            crate::DriverDescriptor {
                protocol_id: "mock".into(),
                version: "0.0.0".into(),
                display_name: "Mock Cancel".into(),
                capabilities: vec![],
            }
        }

        fn validate(&self, _request: &RequestEnvelope) -> crate::ValidationReport {
            crate::ValidationReport::ok()
        }

        async fn execute(
            &self,
            _request: RequestEnvelope,
            mut events: EventSink,
            cancel: CancellationToken,
            _execution_id: ExecutionId,
        ) -> Result<ExecutionSummary, DriverError> {
            if let Some(tx) = self.started.lock().unwrap_or_else(|e| e.into_inner()).take() {
                let _ = tx.send(());
            }
            cancel.cancelled().await;
            events
                .emit(ExecutionEvent::Cancelled {
                    reason: Some("user cancelled".into()),
                })
                .await;
            Err(DriverError::Cancelled)
        }
    }

    fn mock_request() -> RequestEnvelope {
        let mut req = RequestEnvelope::http_get("mock", "https://example.com");
        req.protocol_id = core_domain::ProtocolId("mock".into());
        req.id = RequestId::new();
        req
    }

    #[tokio::test]
    async fn execution_id_is_consistent_across_events_and_summary() {
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockOkDriver));

        let (id, summary, events) = engine
            .execute_collect(mock_request())
            .await
            .expect("execute_collect");

        assert_eq!(summary.execution_id.0, id.0);
        let completed = events.iter().find_map(|e| match e {
            ExecutionEvent::Completed { summary } => Some(summary.execution_id.0),
            _ => None,
        });
        assert_eq!(completed, Some(id.0));
    }

    #[tokio::test]
    async fn runs_builtin_assertions() {
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockOkDriver));
        let mut req = mock_request();
        req.assertions = vec![
            Assertion::StatusEquals { expected: 200 },
            Assertion::BodyContains {
                expected: "ok".into(),
            },
        ];
        let (_, _, events) = engine.execute_collect(req).await.expect("ok");
        let assertion_events: Vec<_> = events
            .iter()
            .filter(|e| matches!(e, ExecutionEvent::AssertionResult(_)))
            .collect();
        assert_eq!(assertion_events.len(), 2);
        assert!(assertion_events.iter().all(|e| match e {
            ExecutionEvent::AssertionResult(r) => r.passed,
            _ => false,
        }));
    }

    #[tokio::test]
    async fn resolves_variables_before_send() {
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockOkDriver));
        let mut req = mock_request();
        req.target = "https://{{host}}/ping".into();
        let mut scope = VariableScope::default();
        scope.environment.insert("host".into(), "example.com".into());
        let (_, _, events) = engine
            .execute_collect_with_scope(req, scope)
            .await
            .expect("ok");
        assert!(events
            .iter()
            .any(|e| matches!(e, ExecutionEvent::Completed { .. })));
    }

    #[tokio::test]
    async fn auth_failure_emits_failed_event() {
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockOkDriver));
        let mut req = mock_request();
        req.auth_ref = Some(core_domain::AuthRef::bearer("missing-token"));
        let (id, mut rx, handle) = engine.execute(req).await.expect("execute");
        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        let err = handle.await.expect("join").expect_err("auth should fail");
        assert!(matches!(err, EngineError::Auth(_)));
        assert!(events.iter().any(|e| matches!(
            e,
            ExecutionEvent::Failed { code, .. } if code == "auth"
        )));
        assert!(!engine.cancel(&id));
    }

    #[tokio::test]
    async fn failed_terminal_events_on_driver_timeout() {
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockTimeoutDriver));

        let (id, mut rx, handle) = engine.execute(mock_request()).await.expect("execute");

        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }
        let result = handle.await.expect("join").expect_err("should fail");
        assert!(matches!(result, EngineError::Driver(DriverError::Timeout(_))));

        assert!(
            events.iter().any(|e| matches!(
                e,
                ExecutionEvent::Failed {
                    code,
                    ..
                } if code == "timeout"
            )),
            "expected Failed event, got {events:?}"
        );
        assert!(events.iter().any(|e| matches!(
            e,
            ExecutionEvent::StateChanged {
                state: ExecutionState::Failed,
                ..
            }
        )));
        assert!(!engine.cancel(&id), "active registry should be empty");
    }

    #[tokio::test]
    async fn cancel_stops_in_flight_execution() {
        let (started_tx, started_rx) = oneshot::channel();
        let mut engine = ExecutionEngine::new();
        engine.register(Arc::new(MockCancelDriver {
            started: Mutex::new(Some(started_tx)),
        }));

        let (id, mut rx, handle) = engine.execute(mock_request()).await.expect("execute");

        started_rx.await.expect("driver started");
        assert!(engine.cancel(&id));

        let mut events = Vec::new();
        while let Some(event) = rx.recv().await {
            events.push(event);
        }

        let result = handle.await.expect("join");
        assert!(matches!(result, Err(EngineError::Cancelled)));
        assert!(events
            .iter()
            .any(|e| matches!(e, ExecutionEvent::Cancelled { .. })));

        // Give the spawned cleanup a moment; registry remove runs before join returns.
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert!(!engine.cancel(&id), "token should be removed after finish");
    }
}
