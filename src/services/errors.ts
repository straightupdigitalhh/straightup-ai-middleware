/**
 * Fehler, deren Message gefahrlos an den Client gehen darf
 * (z. B. "Projekt nicht gefunden"). Alle anderen Fehler werden nur
 * geloggt und dem Client als generische Meldung gezeigt, damit keine
 * Interna (awork-API-Antworten, Pfade) nach außen gelangen.
 */
export class UserFacingError extends Error {}

export const GENERIC_ERROR_MESSAGE = 'Interner Fehler – Details stehen im Server-Log';

export function clientErrorMessage(error: unknown): string {
  return error instanceof UserFacingError ? error.message : GENERIC_ERROR_MESSAGE;
}
