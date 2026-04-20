import { OrderStatus, VALID_TRANSITIONS } from '../types';

/**
 * Asserts that a state transition from `from` → `to` is valid
 * according to the VALID_TRANSITIONS map.
 * Throws an Error with a descriptive message if the transition is not allowed.
 */
export function assertValidTransition(
  orderId: string,
  from: OrderStatus,
  to: OrderStatus
): void {
  const allowed: OrderStatus[] = (VALID_TRANSITIONS[from] as OrderStatus[]) ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `INVALID_TRANSITION: order ${orderId} cannot go from ${from} to ${to}. Allowed: [${allowed.join(', ')}]`
    );
  }
}
