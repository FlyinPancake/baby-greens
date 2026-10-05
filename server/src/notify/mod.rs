//! Sending notifications. The scheduler talks to a [`Notifier`], so tests can swap in a fake
//! and a native app can add APNs or FCM later.

mod web_push;

use serde::Serialize;
use uuid::Uuid;

pub use self::web_push::WebPush;

/// What the service worker shows. It opens `url` when the notification is tapped.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PushMessage {
    pub title: String,
    pub body: String,
    pub url: String,
    /// A newer notification with the same tag replaces the older one on the device.
    pub tag: String,
}

/// A browser's push subscription, as stored in `push_subscriptions`.
#[derive(Debug, Clone)]
pub struct Subscription {
    pub id: Uuid,
    pub endpoint: String,
    pub p256dh: String,
    pub auth: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SendOutcome {
    Sent,
    /// The push service says the subscription no longer exists. Delete it.
    Gone,
}

pub trait Notifier: Send + Sync {
    fn send(
        &self,
        subscription: &Subscription,
        message: &PushMessage,
    ) -> impl Future<Output = anyhow::Result<SendOutcome>> + Send;
}
