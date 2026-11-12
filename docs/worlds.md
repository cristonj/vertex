# Huge worlds, dialogue and interactions

## Endless worlds with streaming

```jsonc
"streaming": { "chunk": 320, "radius": 1, "focus": "player" },
"systems": ["streaming", "rules", "motion", ...]
```

Only chunks within `radius` of a `focus` entity are awake. Everything else sleeps as JSON in
`world.dormant` and wakes exactly as it was. Memory and CPU follow the number of players, not the
size of the world.

Generate content the first time a chunk is seen, from a seed, so the world is the same every
time (and in every runtime):

```jsonc
{ "on": "chunkEnter", "when": "event.fresh", "do": [
  "repeat (10) { let x = event.x + hash(event.cx, event.cy, i) * event.size; let y = event.y + hash(event.cx, event.cy, 50 + i) * event.size; if (noise(x / 200, y / 200, 1) > 0.5) spawn('tree', {x: x, y: y, body: {static: true}}) }"
] }
```

- `hash(a, b, c)` → [0, 1), `noise(x, y, seed)` → smooth [0, 1), `repeat (n) { ... i ... }`.
- `chunkLeave` fires when a chunk goes to sleep. Entities tagged with a `keep` tag never sleep.
- For 3D ground worlds use `"plane": "xz"`.

## Dialogue

```jsonc
"dialogue": {
  "smith": { "start": "hi", "nodes": {
    "hi": { "speaker": "{npc.data.name}", "text": "Need a blade? You have {actor.data.gold} gold.",
      "choices": [
        { "text": "Buy (10 gold)", "when": "actor.data.gold >= 10", "do": "actor.data.gold -= 10; actor.data.sword = true", "goto": "sold" },
        { "text": "Tell me about the mountain", "goto": "lore" },
        { "text": "Bye", "goto": null } ] },
    "lore": { "speaker": "{npc.data.name}", "text": "Long story.\nVery long.", "next": "hi" },
    "sold": { "text": "Mind the edge.", "next": null } } }
}
```

- `{expr}` interpolates rules expressions; `npc` is who you talk to, `actor` is the player.
- `when` hides choices; `do` runs on entering a node or picking a choice; `goto`/`next: null` ends.
- Input: up/down to choose, confirm or interact to advance, or tap/click the box.
- Start from rules with `talk('smith', npc)`; events: `dialogue`, `choice`, `dialogueEnd`.
- Style with `dialogueStyle: { panel, border, textColor, speakerColor, activeColor, size, speed }`.
- Add `"dialogue"` (and `"interact"`) to `systems`.

## Interactions

```jsonc
{ "shape": "npc", "x": 300, "y": 200, "data": { "name": "Ilka" },
  "interact": { "prompt": "Talk", "dialogue": "smith", "radius": 40 } }
{ "shape": "lever", "x": 500, "y": 200,
  "interact": { "prompt": "Pull", "do": "state.gate = true; self.rot = 0.6", "once": true } }
```

The nearest interactable within `radius` of each player shows a prompt; the `interact` action
(key, gamepad button, or tapping the prompt) starts its dialogue or runs `do` with `self` and
`actor` bound. On touch devices the player shows on-screen buttons for every action the
cartridge binds, plus an analog joystick.

See `examples/frontier/frontier.json` for all of this together.
