import type { ModuleJobs } from "@/server/core/module-jobs";
import { publishDueAnnouncements } from "./announcements";
import { syncAllCalendars } from "./calendar-sync";
import { syncAllMailboxes } from "./email";

/** Background work of the comms module, run by the worker (src/worker/index.ts via src/worker/modules.ts). */
export const COMMS_JOBS: ModuleJobs = {
  periodic: [
    { name: "comms.publish-scheduled-announcements", everyMs: 60_000, run: publishDueAnnouncements },
    { name: "comms.sync-mailboxes", everyMs: 5 * 60_000, run: syncAllMailboxes },
    { name: "comms.sync-calendars", everyMs: 15 * 60_000, run: syncAllCalendars },
  ],
  onEvent: [],
};
