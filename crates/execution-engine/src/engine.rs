use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use core_domain::{
    ExecutionEvent, ExecutionId, ExecutionPhase, ExecutionState, ExecutionSummary, RequestEnvelope,
};
use event_stream::EventSink;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tracing::{info, instrument};

use crate::{
    DriverError, EngineError, LifecycleHook, LifecyclePhase, NoopLifecycleHook, ProtocolDriver,
};

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
        let protocol = request.protocol_id.0.clone();
        let driver = self
            .drivers
            .get(&protocol)
            .cloned()
            .ok_or_else(|| EngineError::DriverNotFound(protocol))?;

        let report = driver.validate(&request);
        if !report.is_valid() {
            return Err(EngineError::Driver(DriverError::Validation(
                report.errors.join("; "),
            )));
        }

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
        let (id, mut rx, handle) = self.execute(request).await?;
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
    mut sink: EventSink,
    cancel_child: CancellationToken,
    execution_id: ExecutionId,
    lifecycle: Arc<dyn LifecycleHook>,
) -> Result<ExecutionSummary, EngineError> {
    // P0: no-script path; hooks are invoked so P1 can attach without rewiring.
    lifecycle.on_phase(LifecyclePhase::BeforeRequest).await;
    lifecycle.on_phase(LifecyclePhase::ResolveVariables).await;
    lifecycle.on_phase(LifecyclePhase::BuildRequest).await;

    sink.emit(ExecutionEvent::StateChanged {
        state: ExecutionState::Running,
        phase: Some(ExecutionPhase::Validate),
    })
    .await;

    lifecycle.on_phase(LifecyclePhase::SendRequest).await;

    // Keep a sink clone so we can emit terminal Failed after the driver returns Err.
    let driver_sink = sink.clone();

    match driver
        .execute(request, driver_sink, cancel_child, execution_id)
        .await
    {
        Ok(summary) => {
            lifecycle.on_phase(LifecyclePhase::ReceiveComplete).await;
            lifecycle.on_phase(LifecyclePhase::RunAssertions).await;
            lifecycle.on_phase(LifecyclePhase::ExtractVariables).await;
            lifecycle.on_phase(LifecyclePhase::AfterResponse).await;
            debug_assert_eq!(summary.execution_id.0, execution_id.0);
            drop(sink);
            Ok(summary)
        }
        Err(DriverError::Cancelled) => {
            // Drivers that support cancel emit Cancelled before returning.
            drop(sink);
            Err(EngineError::Cancelled)
        }
        Err(err) => {
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
    use core_domain::RequestId;
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
            let summary = ExecutionSummary {
                execution_id,
                request_id: request.id.0,
                protocol_id: "mock".into(),
                state: ExecutionState::Completed,
                started_at: Utc::now(),
                finished_at: Utc::now(),
                duration_ms: 1,
                bytes_received: 0,
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
