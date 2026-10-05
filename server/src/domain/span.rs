use std::{fmt, str::FromStr, time::Duration as StdDuration};

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use time::Duration;

/// A duration in a plant definition, in humantime syntax: `30m`, `12h`, `4d`, or `1d 12h`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Span(StdDuration);

impl Span {
    pub const fn minutes(minutes: u64) -> Self {
        Self(StdDuration::from_secs(minutes * 60))
    }

    pub const fn hours(hours: u64) -> Self {
        Self::minutes(hours * 60)
    }

    pub const fn days(days: u64) -> Self {
        Self::hours(days * 24)
    }

    pub fn as_duration(self) -> Duration {
        // Parsing rejects spans that don't fit, and the constructors only take small values.
        Duration::try_from(self.0).expect("span fits in time::Duration")
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SpanError {
    #[error(transparent)]
    Parse(#[from] humantime::DurationError),
    #[error("must be longer than zero")]
    Zero,
    #[error("is too long")]
    TooLong,
}

impl FromStr for Span {
    type Err = SpanError;

    fn from_str(text: &str) -> Result<Self, SpanError> {
        let duration = humantime::parse_duration(text)?;
        if duration.is_zero() {
            return Err(SpanError::Zero);
        }
        if Duration::try_from(duration).is_err() {
            return Err(SpanError::TooLong);
        }
        Ok(Self(duration))
    }
}

impl fmt::Display for Span {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        humantime::format_duration(self.0).fmt(f)
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

    fn parse(text: &str) -> Span {
        text.parse()
            .unwrap_or_else(|error| panic!("{text:?}: {error}"))
    }

    #[test]
    fn parses_humantime_syntax() {
        assert_eq!(parse("45m"), Span::minutes(45));
        assert_eq!(parse("12h"), Span::hours(12));
        assert_eq!(parse("4d"), Span::days(4));
        assert_eq!(parse("1d 12h"), Span::hours(36));
        assert_eq!(parse("1d12h"), Span::hours(36));
        assert_eq!(parse("90min"), Span::minutes(90));
    }

    #[test]
    fn rejects_bad_input() {
        for text in ["", "h", "12", "-2h", "12H", "twelve hours"] {
            assert!(
                matches!(text.parse::<Span>(), Err(SpanError::Parse(_))),
                "{text:?}"
            );
        }
        assert!(matches!("0h".parse::<Span>(), Err(SpanError::Zero)));
        // Fits in std's Duration but not in time's, which the scheduler uses.
        assert!(matches!(
            "400000000000years".parse::<Span>(),
            Err(SpanError::TooLong)
        ));
    }

    #[test]
    fn displays_in_humantime_format() {
        assert_eq!(Span::hours(12).to_string(), "12h");
        assert_eq!(Span::hours(36).to_string(), "1day 12h");
        assert_eq!(Span::days(4).to_string(), "4days");
    }

    #[test]
    fn round_trips_through_json() {
        let span: Span = serde_json::from_str("\"1d 12h\"").unwrap();
        let json = serde_json::to_string(&span).unwrap();
        assert_eq!(json, "\"1day 12h\"");
        assert_eq!(serde_json::from_str::<Span>(&json).unwrap(), span);

        let error = serde_json::from_str::<Span>("\"8 hourz\"").unwrap_err();
        assert!(
            error.to_string().contains("invalid duration \"8 hourz\""),
            "{error}"
        );
    }
}
