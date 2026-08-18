# Import from Postman and OpenAPI

ApiVoy can import common API description formats into collections.

## Supported formats

- cURL commands
- OpenAPI 3.x (JSON or YAML)
- HAR
- Postman Collection v2.x
- ApiVoy project packages

## OpenAPI

1. Open **Import** from the workspace explorer.
2. Select an OpenAPI file.
3. Review mapped folders, environments, and generated requests.
4. Confirm import — sensitive placeholders are flagged when detected.

Internal and external `$ref` links are resolved with cycle detection.

## Postman

Postman environment and collection variables map to ApiVoy environments where possible. Replace `{{token}}` values with `secret_ref` entries after import.

## After import

- Run smoke requests against public endpoints first (e.g. httpbin.org).
- Rotate any credentials that were embedded in source files before import.

See [examples/import/](../../examples/http/) for sample-compatible requests.
