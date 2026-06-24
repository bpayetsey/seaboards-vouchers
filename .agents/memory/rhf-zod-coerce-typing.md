---
name: RHF + zod.coerce typing
description: How to type react-hook-form forms that use a zod schema with z.coerce, and the useFieldArray control gotcha.
---

# react-hook-form + zod.coerce typing

Two distinct issues seen together in subagent-generated form code:

1. **`useFieldArray` must receive `control: form.control`, NOT `control: form`.** Passing the whole `form` object produces a confusing `Control` type mismatch ("missing _subjects, _removeUnmounted, _names, _state...") that looks like a duplicate-package problem but isn't.

2. **`z.coerce` makes the schema's input type differ from its output type.** Type `useForm` with three generics so the resolver/transform line up:
   ```ts
   useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), ... })
   ```
   `onSubmit` then receives `z.output<...>` (the coerced/transformed values). `field` items from `useFieldArray` carry the input-side types.

**Why:** with `@hookform/resolvers@3` + zod v3 (`zod` ^3.25 exposes `zod/v4` too), `z.coerce.number()` etc. give input=string/unknown, output=number; a single `useForm<z.infer>` generic collapses inference and breaks `useFieldArray`.
