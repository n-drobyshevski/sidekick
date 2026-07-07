// Dev dataset: currently identical to the shipped dry-run seed. The indirection
// exists so a future amplified dev dataset can diverge without touching the shipped
// sample. serve.mjs maps "./sampleData" imports here; this file must reach the real
// module via ../src/server/sampleData so the resolver filter never matches it.

export * from "../src/server/sampleData";
