// Shared by show authoring, server validation and participant decoded-buffer accounting.
// Temporary decode allocations and other browser memory are additional to this ceiling.
export const DECODED_AUDIO_BUDGET_BYTES = 512 * 1024 * 1024;
