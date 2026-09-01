use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

static HTTP_CLIENT: OnceLock<Client> = OnceLock::new();




pub fn http_client() -> &'static Client {
    HTTP_CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
}
