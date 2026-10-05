//! Quiet hours: a daily stretch of local time with no notifications, like 22:00 to 07:00.

use serde::{Deserialize, Deserializer, Serialize, Serializer, de};
use time::{
    OffsetDateTime, Time, format_description::BorrowedFormatItem, macros::format_description,
};
use utoipa::ToSchema;

const HH_MM: &[BorrowedFormatItem<'static>] = format_description!("[hour]:[minute]");

/// Quiet hours in a user's local time. `end` before `start` means they run past midnight.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct QuietHours {
    #[serde(with = "hh_mm")]
    #[schema(value_type = String, example = "22:00")]
    pub start: Time,
    #[serde(with = "hh_mm")]
    #[schema(value_type = String, example = "07:00")]
    pub end: Time,
}

impl QuietHours {
    /// Whether `local` falls inside. The start is inside and the end is not. Equal start and
    /// end mean no quiet time at all.
    pub fn contains(&self, local: Time) -> bool {
        if self.start <= self.end {
            self.start <= local && local < self.end
        } else {
            local >= self.start || local < self.end
        }
    }
}

/// Whether `name` is an IANA timezone, like `Europe/Budapest`.
pub fn is_timezone(name: &str) -> bool {
    jiff::tz::TimeZone::get(name).is_ok()
}

/// The wall-clock time at `instant` in `timezone`. Unknown timezones count as UTC.
pub fn local_time(instant: OffsetDateTime, timezone: &str) -> Time {
    let tz = jiff::tz::TimeZone::get(timezone).unwrap_or(jiff::tz::TimeZone::UTC);
    let Ok(timestamp) = jiff::Timestamp::from_nanosecond(instant.unix_timestamp_nanos()) else {
        return instant.time();
    };
    let civil = timestamp.to_zoned(tz).time();
    Time::from_hms(
        civil.hour().unsigned_abs(),
        civil.minute().unsigned_abs(),
        civil.second().unsigned_abs(),
    )
    .unwrap_or(Time::MIDNIGHT)
}

/// Serializes `Time` as `HH:MM`.
mod hh_mm {
    use super::*;

    pub fn serialize<S: Serializer>(time: &Time, serializer: S) -> Result<S::Ok, S::Error> {
        let text = time.format(HH_MM).map_err(serde::ser::Error::custom)?;
        serializer.serialize_str(&text)
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Time, D::Error> {
        let text = String::deserialize(deserializer)?;
        Time::parse(&text, HH_MM)
            .map_err(|_| de::Error::custom(format!("invalid time {text:?}, expected HH:MM")))
    }
}

#[cfg(test)]
mod tests {
    use time::macros::{datetime, time};

    use super::*;

    #[test]
    fn same_day_quiet_hours() {
        let lunch = QuietHours {
            start: time!(12:00),
            end: time!(13:00),
        };
        assert!(!lunch.contains(time!(11:59)));
        assert!(lunch.contains(time!(12:00)));
        assert!(lunch.contains(time!(12:59)));
        assert!(!lunch.contains(time!(13:00)));
    }

    #[test]
    fn overnight_quiet_hours() {
        let night = QuietHours {
            start: time!(22:00),
            end: time!(07:00),
        };
        assert!(night.contains(time!(22:00)));
        assert!(night.contains(time!(23:59)));
        assert!(night.contains(time!(00:00)));
        assert!(night.contains(time!(06:59)));
        assert!(!night.contains(time!(07:00)));
        assert!(!night.contains(time!(12:00)));
        assert!(!night.contains(time!(21:59)));
    }

    #[test]
    fn equal_start_and_end_is_never_quiet() {
        let none = QuietHours {
            start: time!(08:00),
            end: time!(08:00),
        };
        assert!(!none.contains(time!(08:00)));
        assert!(!none.contains(time!(20:00)));
    }

    #[test]
    fn local_time_follows_the_timezone() {
        // 21:30 UTC in October is 23:30 in Budapest (CEST) and 17:30 in New York (EDT).
        let instant = datetime!(2026-10-05 21:30 UTC);
        assert_eq!(local_time(instant, "Europe/Budapest"), time!(23:30));
        assert_eq!(local_time(instant, "America/New_York"), time!(17:30));
        assert_eq!(local_time(instant, "UTC"), time!(21:30));
        assert_eq!(local_time(instant, "Not/AZone"), time!(21:30));

        // After the clocks change, Budapest is only an hour ahead.
        assert_eq!(
            local_time(datetime!(2026-11-05 21:30 UTC), "Europe/Budapest"),
            time!(22:30)
        );
    }

    #[test]
    fn timezone_names() {
        assert!(is_timezone("Europe/Budapest"));
        assert!(is_timezone("UTC"));
        assert!(!is_timezone("Mars/Olympus_Mons"));
        assert!(!is_timezone(""));
    }

    #[test]
    fn quiet_hours_json() {
        let hours: QuietHours =
            serde_json::from_str(r#"{ "start": "22:00", "end": "07:30" }"#).unwrap();
        assert_eq!(
            hours,
            QuietHours {
                start: time!(22:00),
                end: time!(07:30)
            }
        );
        assert_eq!(
            serde_json::to_string(&hours).unwrap(),
            r#"{"start":"22:00","end":"07:30"}"#
        );
        assert!(
            serde_json::from_str::<QuietHours>(r#"{ "start": "25:00", "end": "07:00" }"#).is_err()
        );
    }
}
