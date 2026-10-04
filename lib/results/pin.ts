import { createHash, randomInt } from "node:crypto";

/** Result-checker PINs are 12 digits, printed and entered as "4821 7730 5519". */
export const PIN_LENGTH = 12;

export function normalisePin(input: string): string {
  return input.replace(/\D/g, "");
}

export function isWellFormedPin(input: string): boolean {
  return normalisePin(input).length === PIN_LENGTH;
}

export function formatPin(pin: string): string {
  return normalisePin(pin).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Salted with the school id so equal PINs in two schools hash differently. */
export function hashPin(schoolId: string, pin: string): string {
  return createHash("sha256").update(`${schoolId}:${normalisePin(pin)}`).digest("hex");
}

export function generatePin(): string {
  let pin = "";
  for (let i = 0; i < PIN_LENGTH; i++) pin += randomInt(0, 10).toString();
  return pin;
}
