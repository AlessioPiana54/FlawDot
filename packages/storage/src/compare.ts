/**
 * Orders two strings by their code units, whatever the language of the machine (`localeCompare` follows it).
 * Ids are ULIDs and dates are ISO strings, so this order is the order of creation.
 */
export const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
