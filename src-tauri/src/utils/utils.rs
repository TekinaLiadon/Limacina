use std::cmp::Ordering;

pub fn compare_versions(v1: &str, v2: &str) -> Ordering {
    let parts1: Vec<&str> = v1.split(|c: char| !c.is_ascii_alphanumeric()).collect();
    let parts2: Vec<&str> = v2.split(|c: char| !c.is_ascii_alphanumeric()).collect();
    let max_len = std::cmp::max(parts1.len(), parts2.len());

    for i in 0..max_len {
        let p1 = parts1.get(i).unwrap_or(&"0");
        let p2 = parts2.get(i).unwrap_or(&"0");

        match (p1.parse::<u32>(), p2.parse::<u32>()) {
            (Ok(n1), Ok(n2)) => {
                if n1 != n2 {
                    return n1.cmp(&n2);
                }
            }
            _ => {
                if p1 != p2 {
                    return p1.cmp(p2);
                }
            }
        }
    }
    Ordering::Equal
}
