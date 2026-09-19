import { createHash, timingSafeEqual } from "node:crypto";

// Hashing first makes the comparison constant time regardless of length. There is deliberately
// no default secret: an unset OPERATOR_SECRET denies every operator request rather than
// shipping a known password.
export const matchesOperatorSecret = (
  provided: string | null | undefined,
  expected = process.env.OPERATOR_SECRET,
): boolean => {
  if (!expected || !provided) return false;
  return timingSafeEqual(
    createHash("sha256").update(provided).digest(),
    createHash("sha256").update(expected).digest(),
  );
};
