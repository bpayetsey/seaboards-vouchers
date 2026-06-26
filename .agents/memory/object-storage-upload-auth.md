---
name: Object storage upload endpoint auth
description: The copied object-storage template ships the presigned-upload route unauthenticated — gate it.
---

The object-storage skill template's `POST /storage/uploads/request-url` route ships with **no auth**. Its paired serving route `GET /storage/objects/*` is intentionally public (ACL check commented out).

**Why:** Left as-is, those two together form an open file host — anyone can mint a presigned PUT URL, upload arbitrary bytes, and retrieve them publicly via the returned `objectPath`. That is broken access control (abuse, cost, illegal-content risk).

**How to apply:** Whenever you copy the storage template, gate the upload-URL route (and any "register uploaded object" admin route) behind your auth middleware (here: `requireStaff`). Also validate that any caller-supplied `object_path` starts with `/objects/` before trusting it. Keep public serving only for content that is meant to be public (e.g. the gallery).
