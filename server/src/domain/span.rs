use std::{fmt, str::FromStr};

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use time::Duration;

/// A duration in a plant definition, written as a whole number and a unit: `30m`, `12h`, or `4d`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Span {
    minutes: u32,
}

impl Span {
    pub const fn minutes(minutes: u32) -> Self {
        Self { minutes }
    }

    pub const fn hours(hours: u32) -> Self {
        Self::minutes(hours * 60)
    }

    pub const fn days(days: u32) -> Self {
        Self::hours(days * 24)
    }

    pub fn as_duration(self) -> Duration {
        Duration::minutes(self.minutes.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SpanError {
    #[error("expected a whole number followed by m, h, or d, like \"12h\"")]
    Format,
    #[error("must be longer than zero")]
    Zero,
    #[error("is too long")]
    TooLong,
}

impl FromStr for Span {
    type Err = SpanError;

    fn from_str(text: &str) -> Result<Self, SpanError> {
        if !text.is_ascii() || text.len() < 2 {
            return Err(SpanError::Format);
        }

        let (number, unit) = text.split_at(text.len() - 1);
        if !number.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(SpanError::Format);
        }

        let minutes_per_unit = match unit {
            "m" => 1,
            "h" => 60,
            "d" => 24 * 60,
            _ => return Err(SpanError::Format),
        };

        let value: u32 = number.parse().map_err(|_| SpanError::TooLong)?;
        if value == 0 {
            return Err(SpanError::Zero);
        }

        let minutes = value
            .checked_mul(minutes_per_unit)
            .ok_or(SpanError::TooLong)?;
        Ok(Self { minutes })
    }
}

/// Uses the largest unit that divides the span evenly, so `24h` prints as `1d`.
impl fmt::Display for Span {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        const DAY: u32 = 24 * 60;
        match self.minutes {
            minutes if minutes % DAY == 0 => write!(f, "{}d", minutes / DAY),
            minutes if minutes % 60 == 0 => write!(f, "{}h", minutes / 60),
            minutes => write!(f, "{minutes}m"),
        }
    }
}

impl Serialize for Span {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Span {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        text.parse()
            .map_err(|error| de::Error::custom(format!("invalid duration {text:?}: {error}")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_each_unit() {
        assert_eq!("45m".parse(), Ok(Span::minutes(45)));
        assert_eq!("12h".parse(), Ok(Span::hours(12)));
        assert_eq!("4d".parse(), Ok(Span::days(4)));
    }

    #[test]
    fn rejects_bad_input() {
        for text in [
            "", "h", "12", "1.5h", "-2h", "12 h", "12H", "1d12h", "3w", "١٢h",
        ] {
            assert_eq!(text.parse::<Span>(), Err(SpanError::Format), "{text:?}");
        }
        assert_eq!("0h".parse::<Span>(), Err(SpanError::Zero));
        assert_eq!("99999999999d".parse::<Span>(), Err(SpanError::TooLong));
        assert_eq!("4000000d".parse::<Span>(), Err(SpanError::TooLong));
    }

    #[test]
    fn displays_the_largest_even_unit() {
        assert_eq!(Span::hours(24).to_string(), "1d");
        assert_eq!(Span::hours(36).to_string(), "36h");
        assert_eq!(Span::minutes(90).to_string(), "90m");
    }

    #[test]
    fn round_trips_through_json() {
        let span: Span = serde_json::from_str("\"8h\"").unwrap();
        assert_eq!(serde_json::to_string(&span).unwrap(), "\"8h\"");

        let error = serde_json::from_str::<Span>("\"8 hours\"").unwrap_err();
        assert!(error.to_string().contains("invalid duration \"8 hours\""));
    }
}
