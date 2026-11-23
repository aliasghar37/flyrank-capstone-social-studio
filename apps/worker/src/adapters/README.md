# Adapters

Phase 4 adds the four `SocialPublisher` implementations here:

- `telegram.ts` — real, `POST /bot<token>/sendMessage`.
- `discord.ts` — real, webhook `?wait=true`.
- `mock.ts` — one base class used by `mock_x` and `mock_linkedin`; writes `mock_posts`.

Also add `registry.ts`: the only place adapter names appear. Business code calls
`resolvePublisher(adapterKey)` and never branches on platform names. An adapter swap must be a
`config/platforms.json` change, not a code change.
