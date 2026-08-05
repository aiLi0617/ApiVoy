# collaboration-server (P2, commercial)

Java 21 + Spring Boot 3 + **Gradle Wrapper**.

This service hosts team sync, identity, audit, and related enterprise features.
It is **not** part of the Apache-2.0 core open-source boundary described in the root `NOTICE`.

## Planned layout

```text
services/collaboration-server/
├── gradlew
├── gradlew.bat
├── gradle/wrapper/
├── settings.gradle.kts
├── build.gradle.kts
└── src/
```

Windows:

```bat
.\gradlew.bat clean build
.\gradlew.bat bootRun
```

P0/MVP does not implement this service. Scaffold the Gradle Wrapper when P2 starts and commit wrapper jars + checksum properties.
