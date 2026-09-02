"use client";

/**
 * A sub admin's Data Bank.
 *
 * Deliberately the same component the admin uses rather than a copy: the two
 * differ only in which folders the query returns and whether the folder CRUD
 * controls render, both of which that component already decides from the
 * signed-in role. A second implementation would be the obvious place for the
 * promote flow to drift between the two.
 */
export { default } from "@/app/admin/data-bank/page";
