//! Controllers, through gilrs, as an Iced subscription.
//!
//! gilrs is polled on a thread of its own (its handle is not `Send` on every
//! platform) and what it reports is turned into the same few presses the
//! keyboard makes, so `update` never knows which one was used.

use iced::futures::{SinkExt, StreamExt};
use iced::Subscription;

/// What a pad can ask for. The same actions as the Tauri launcher's pad map.
#[derive(Debug, Clone)]
pub enum Pad {
    /// A pad arrived or left, by name, for the debug view.
    Connected(String),
    Disconnected,
    Move(i32),
    /// South (A / Cross): the primary action.
    Confirm,
    /// East (B / Circle): back out.
    Back,
    /// West (X / Square): eject.
    Eject,
    /// North (Y / Triangle): the debug view.
    Debug,
}

pub fn subscription() -> Subscription<Pad> {
    Subscription::run(stream)
}

fn stream() -> impl iced::futures::Stream<Item = Pad> {
    iced::stream::channel(32, async |mut output| {
        let (sender, mut receiver) = iced::futures::channel::mpsc::unbounded();
        std::thread::spawn(move || poll(sender));
        while let Some(event) = receiver.next().await {
            if output.send(event).await.is_err() {
                break;
            }
        }
    })
}

/// The polling loop. Ends when nobody is listening any more, or when gilrs
/// cannot start at all — a machine with no pad support still gets a launcher.
fn poll(sender: iced::futures::channel::mpsc::UnboundedSender<Pad>) {
    use gilrs::{Axis, Button, EventType};

    let Ok(mut gilrs) = gilrs::Gilrs::new() else {
        return;
    };
    for (_, gamepad) in gilrs.gamepads() {
        let _ = sender.unbounded_send(Pad::Connected(gamepad.name().to_string()));
    }

    // The stick moves one step per push, like the d-pad, rather than
    // streaming: past 0.6 is a push, back under 0.3 is released.
    let mut stick_held = false;

    loop {
        while let Some(event) = gilrs.next_event() {
            let pad = match event.event {
                EventType::Connected => {
                    Some(Pad::Connected(gilrs.gamepad(event.id).name().to_string()))
                }
                EventType::Disconnected => Some(Pad::Disconnected),
                EventType::ButtonPressed(button, _) => match button {
                    Button::South | Button::Start => Some(Pad::Confirm),
                    Button::East => Some(Pad::Back),
                    Button::West => Some(Pad::Eject),
                    Button::North => Some(Pad::Debug),
                    Button::DPadUp | Button::DPadLeft => Some(Pad::Move(-1)),
                    Button::DPadDown | Button::DPadRight => Some(Pad::Move(1)),
                    _ => None,
                },
                EventType::AxisChanged(Axis::LeftStickY | Axis::LeftStickX, value, _) => {
                    if !stick_held && value.abs() > 0.6 {
                        stick_held = true;
                        // gilrs reports up as positive Y; up means previous.
                        let is_y =
                            matches!(event.event, EventType::AxisChanged(Axis::LeftStickY, ..));
                        let step = if is_y {
                            -value.signum()
                        } else {
                            value.signum()
                        };
                        Some(Pad::Move(step as i32))
                    } else {
                        if value.abs() < 0.3 {
                            stick_held = false;
                        }
                        None
                    }
                }
                _ => None,
            };
            if let Some(pad) = pad {
                if sender.unbounded_send(pad).is_err() {
                    return;
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(16));
    }
}
