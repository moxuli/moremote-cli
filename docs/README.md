# Documentation index

- [Current state and external gates](STATE.md)
- [Architecture](specs/01-architecture.md)
- [Encrypted delivery contract v1](specs/02-encrypted-delivery.md)
- [Relay HTTP contract v1](specs/03-api-contract.md)
- [Endpoint controls, occurrences and receipt lifecycle](specs/04-control-and-receipt-lifecycle.md)
- [Endpoint and lifecycle behavior](specs/05-endpoint-and-lifecycle.md)
- [Configuration registry](configuration.md)
- [Conventions](conventions.md)
- [Implementation plan](plans/2026-11-10-notification-delivery.md)
- [Changelog](../CHANGELOG.md)

02/03/04 are independently carried relay-v1 contract copies, not sibling runtime dependencies. Public known-answer fixtures are vectors/envelope-v1.json (independent Node hkdfSync/createCipheriv reference) and vectors/bearer-v1.json (canonical bearer text hashing). Endpoint implementation uses standard WebCrypto.
