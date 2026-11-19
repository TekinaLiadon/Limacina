use anyhow::{anyhow, Context, Result};

use crate::utils::errors::LauncherError;

pub fn header_raw<'a>(headers: &'a tauri::http::HeaderMap, name: &str) -> Option<&'a str> {
    headers.get(name).and_then(|value| value.to_str().ok())
}

pub fn decode_percent_header(raw: &str, header: &str) -> Result<String> {
    let bytes = raw.as_bytes();
    let mut decoded: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            decoded.push(bytes[index]);
            index += 1;
            continue;
        }
        let hex = bytes
            .get(index + 1..index + 3)
            .ok_or_else(|| anyhow!("Некорректное значение заголовка {header}"))?;
        let hex = std::str::from_utf8(hex)
            .map_err(|_| anyhow!("Некорректное значение заголовка {header}"))?;
        if !hex.as_bytes().iter().all(u8::is_ascii_hexdigit) {
            return Err(anyhow!("Некорректное значение заголовка {header}"));
        }
        let byte = u8::from_str_radix(hex, 16)
            .map_err(|_| anyhow!("Некорректное значение заголовка {header}"))?;
        decoded.push(byte);
        index += 3;
    }
    String::from_utf8(decoded).with_context(|| format!("Некорректное значение заголовка {header}"))
}

pub fn required_text_header(headers: &tauri::http::HeaderMap, name: &str) -> Result<String> {
    let raw = header_raw(headers, name).ok_or_else(|| {
        anyhow!(LauncherError::InvalidInput(format!(
            "Не указан заголовок {name}"
        )))
    })?;
    decode_percent_header(raw, name)
}

pub fn optional_text_header(
    headers: &tauri::http::HeaderMap,
    name: &str,
) -> Result<Option<String>> {
    match header_raw(headers, name) {
        Some(raw) => Ok(Some(decode_percent_header(raw, name)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode_percent_header, optional_text_header, required_text_header};
    use crate::utils::errors::LauncherError;
    use anyhow::Context as _;

    fn headers(pairs: &[(&'static str, &'static str)]) -> tauri::http::HeaderMap {
        let mut map = tauri::http::HeaderMap::new();
        for (name, value) in pairs {
            map.insert(
                *name,
                tauri::http::HeaderValue::from_str(value).expect("значение заголовка"),
            );
        }
        map
    }

    #[test]
    fn decodes_percent_encoded_utf8() {
        assert_eq!(
            decode_percent_header("Hecate%20%C3%84", "Test").expect("декодирование"),
            "Hecate Ä"
        );
    }

    #[test]
    fn rejects_truncated_percent_escape() {
        let error = decode_percent_header("bad%2", "Test").expect_err("обрывок escape");

        assert!(
            error.to_string().contains("Test"),
            "ошибка называет заголовок"
        );
    }

    #[test]
    fn required_header_errors_when_missing() {
        let error =
            required_text_header(&headers(&[]), "Project-Name").expect_err("заголовок обязателен");

        assert!(
            matches!(
                error.downcast_ref::<LauncherError>(),
                Some(LauncherError::InvalidInput(_))
            ),
            "ожидается InvalidInput: {error}"
        );
    }

    #[test]
    fn optional_header_returns_none_when_missing() {
        assert!(optional_text_header(&headers(&[]), "Model-Url")
            .expect("отсутствующий необязательный заголовок")
            .is_none());
    }

    #[test]
    fn optional_header_decodes_value() {
        let value = optional_text_header(
            &headers(&[("Model-Url", "https%3A%2F%2Fexample.com")]),
            "Model-Url",
        )
        .context("чтение заголовка")
        .expect("заголовок присутствует");

        assert_eq!(value.as_deref(), Some("https://example.com"));
    }
}
