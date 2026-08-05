//! Bounded event sink used by drivers and the execution engine.

use core_domain::ExecutionEvent;
use tokio::sync::mpsc;
use tracing::warn;

const DEFAULT_CAPACITY: usize = 256;

#[derive(Debug)]
pub struct EventSink {
    tx: mpsc::Sender<ExecutionEvent>,
    dropped: u64,
}

impl Clone for EventSink {
    /// Clones the channel sender so the engine can emit terminal events after the driver returns.
    fn clone(&self) -> Self {
        Self {
            tx: self.tx.clone(),
            dropped: 0,
        }
    }
}

impl EventSink {
    pub fn channel() -> (Self, mpsc::Receiver<ExecutionEvent>) {
        Self::with_capacity(DEFAULT_CAPACITY)
    }

    pub fn with_capacity(capacity: usize) -> (Self, mpsc::Receiver<ExecutionEvent>) {
        let (tx, rx) = mpsc::channel(capacity);
        (
            Self {
                tx,
                dropped: 0,
            },
            rx,
        )
    }

    pub async fn emit(&mut self, event: ExecutionEvent) {
        if self.tx.send(event).await.is_err() {
            self.dropped = self.dropped.saturating_add(1);
            warn!(dropped = self.dropped, "execution event receiver closed");
        }
    }

    pub fn try_emit(&mut self, event: ExecutionEvent) {
        match self.tx.try_send(event) {
            Ok(()) => {}
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.dropped = self.dropped.saturating_add(1);
                warn!(dropped = self.dropped, "execution event channel full; dropping");
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.dropped = self.dropped.saturating_add(1);
            }
        }
    }

    pub fn dropped_count(&self) -> u64 {
        self.dropped
    }
}
