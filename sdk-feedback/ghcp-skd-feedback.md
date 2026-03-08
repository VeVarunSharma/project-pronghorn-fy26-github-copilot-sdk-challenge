# GitHub Copilot SDK Feedback — Project Pronghorn Government of Alberta Enterprise App Generator

_@github/copilot-sdk v0.1.25, Node.js/TypeScript, server-side usage_

---

We shipped an enterprise app generator for the Government of Alberta on top of the Copilot SDK.
The agent runtime itself held up well — sessions, tool invocation, and context compaction all
worked once we got things wired up. But "once we got things wired up" is doing a lot of work in that sentence.

Here's what actually slowed us (my clanker agents) down, roughly ordered by how much it hurt.

---

## The server-side docs gap is the biggest blocker for enterprise adoption

Every example in the docs — the README, the cookbook, all of it — assumes you're building a CLI tool or an IDE extension. There is nothing for teams building backend services: no Next.js API route example, no Express pattern, no guidance on how to manage session lifecycle across HTTP requests, no SSE streaming setup.

We (me and my clanker agents) had to figure all of this out from scratch. That's not a minor inconvenience for a government client with procurement timelines and a fixed delivery date, that can be hours/days of unplanned work that could have been an afternoon with one good example.

This is the single highest-leverage documentation change the team could make. Enterprise teams don't build CLI tools. They build services. If the SDK is being positioned for production enterprise use, the docs should reflect that.

---

## No TypeScript types exported means every consumer writes their own

The Node.js SDK doesn't export types for session events, event string literals, or delta payload shapes. So when you write `session.on("session.idle", ...)` you're working against `unknown`. We ended up writing and maintaining our own `SessionLike`, `SessionEvent`, and `DeltaPayload` interfaces — which is fine, but it means every team building on this SDK is doing the same thing independently.

This is a real cost for TypeScript shops. Type safety is why they chose TypeScript. An SDK that makes you cast through `unknown` to do basic things will get a reputation as a second-class citizen in the TS ecosystem, which matters if GitHub wants enterprise TypeScript teams adopting this seriously.

The fix is straightforward — export the types. The SDK clearly has them internally.

---

## "Encrypted content is not supported" can be a silent productivity killer

This is the error you get when you use a model that isn't compatible with the SDK. The message tells you nothing — there's no indication it's a model issue, no suggestion of what to use instead, no link to anything.

We spent a non-trivial amount of time debugging what we thought was an auth or config issue before realizing it was the model string. In a government delivery context that's embarrassing to explain in a stand-up.

The fix is a one-liner: catch this error and re-throw it with a message that says "model X isn't supported — call `listModels()` to see what is." That's it. The ROI on this fix is extremely high relative to the effort.

---

## Waiting for a full response requires boilerplate every single time

If you want to send a prompt and await the complete response — which is the most common thing you do with an LLM in a backend service — you have to manually compose `session.on("session.idle")` and `session.on("session.error")` with your own timeout logic. Every time. In every project.

This pattern is so universal that the SDK's own Quick Start examples show it. That's a sign it should be a first-class method, not something every developer builds themselves. A `sendAndWait()` or similar would make non-streaming use cases (structured JSON generation, form processing, classification tasks) dramatically cleaner.
