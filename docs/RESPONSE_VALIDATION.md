# Response validation

HTTP response validation uses schema version `2` and structured rules. Each rule has a stable ID, an enabled state, a target, an operator, and optional selector and expected value. The request-level switch is stored separately and does not remove rules.

Interface-design validation is separate from post-response assertions. Project settings control whether HTTP status, headers, body format, body schema, and additional object properties are checked. The debug response selector is populated from the response statuses defined by the bound interface definition (default `200`).

Requests without `metadata.__apivoyAssertionSchemaVersion: 2` do not load legacy assertions. Legacy text DSL is intentionally unsupported.

Rules generated from a response are drafts until the user saves the editor. JSON generation is bounded to 1 MB, 300 visited nodes, and 8 levels of recursion. Arrays generate a length rule and inspect only their first element.

An HTTP execution remains completed when assertions fail. Assertion results carry the stable rule ID, expected and actual values, and a failure reason; collection and CLI runners continue to treat failed assertions as test failures.
