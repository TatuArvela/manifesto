import { describeAccountKeysContract } from "#/storage/contracts/accountKeysContract.ts";
import { describeAttachmentsContract } from "#/storage/contracts/attachmentsContract.ts";
import { describeCommentsContract } from "#/storage/contracts/commentsContract.ts";
import { describeOAuthContract } from "#/storage/contracts/oauthContract.ts";
import { describePasskeysContract } from "#/storage/contracts/passkeysContract.ts";
import { describePrefsContract } from "#/storage/contracts/prefsContract.ts";
import { describePublicLinksContract } from "#/storage/contracts/publicLinksContract.ts";
import { describePushContract } from "#/storage/contracts/pushContract.ts";
import { describeStatsContract } from "#/storage/contracts/statsContract.ts";
import { describeSyncContract } from "#/storage/contracts/syncContract.ts";
import { describeTeamsContract } from "#/storage/contracts/teamsContract.ts";
import { createSqliteStorage } from "./driver.ts";

describeAttachmentsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeStatsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePrefsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeSyncContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePublicLinksContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeTeamsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeOAuthContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePasskeysContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeAccountKeysContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describeCommentsContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);

describePushContract("sqlite", async () =>
  createSqliteStorage({ dbPath: ":memory:" }),
);
