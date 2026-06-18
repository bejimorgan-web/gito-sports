# ACTIVE_WORKING_DATABASE_AUDIT

## 1. Summary

A. Most recent operator activity: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`

B. Database containing the most recent published stream record: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend\data\gito.sqlite` (duplicate also in `node_modules\@gito\backend\data\gito.sqlite`).

C. Database containing the IPTV provider associated with the last successful live broadcast: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend\data\gito.sqlite`.

D. Active working database to consider: `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite`.

> This audit is read-only. No code changes, migrations, or database modifications were made.

## 2. Database activity map

| Rank | ABSOLUTE_PATH | CLASSIFICATION | latest_activity_ts | LATEST_PROVIDER | LATEST_SPORT | LATEST_COMPETITION | LATEST_MATCH | LATEST_STREAM | PUBLISHED_STREAMS |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite` | OPERATOR_DB | 2026-06-01T16:55:29.182Z | `78dc0da9-7a89-44ee-aee1-38431531f0c9` (created_at 2026-06-01T16:55:29.182Z) | `d55bce6a-d809-49d5-afc7-4ee8ba059631` (updated_at 2026-06-01T00:49:07.447Z) | `ea9c05e9-f411-45d2-9cb5-2371cdd7b61e` (created_at 2026-06-01T00:49:07.768Z) | `50f95111-571d-437f-9046-cfcd70209eba` (updated_at 2026-06-01T00:49:11.018Z) | `efb314bd-a4e5-4c65-8a1d-173151cfc4c6` (published_at 2026-06-01T00:49:11.018Z) | 2 |
| 2 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend\data\gito.sqlite` | TEST_DB | 2026-06-01T16:20:29.368Z | `5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5` (created_at 2026-05-30T11:48:55.635Z) | `40658823-67c2-4564-8974-3ac180f8bb4e` (updated_at 2026-06-01T10:17:10.728Z) | `5787afaf-24ab-4732-98d1-39273642707c` (created_at 2026-06-01T10:18:22.989Z) | `bf0356f8-a01a-46d9-9602-b4f552cbb4d0` (updated_at 2026-06-01T16:04:47.413Z) | `a3a8d413-1783-4102-9755-2bcb664f6824` (published_at 2026-06-01T16:04:47.413Z) | 5 |
| 3 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\node_modules\@gito\backend\data\gito.sqlite` | DUPLICATE_DB | 2026-06-01T16:20:29.368Z | `5d6ef24c-4b4f-4883-a0fe-480cc5c3aaa5` | `40658823-67c2-4564-8974-3ac180f8bb4e` | `5787afaf-24ab-4732-98d1-39273642707c` | `bf0356f8-a01a-46d9-9602-b4f552cbb4d0` | `a3a8d413-1783-4102-9755-2bcb664f6824` | 5 |
| 4 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\enforcement-validation-1780271648113.sqlite` | TEST_DB | 2026-05-31T23:54:36.990Z | `881ab7a3-c029-4878-a4a9-a1ec9cac3ae9` | `a15f4ddf-42d5-4d77-83e0-980360e271be` | `097c3e4a-caf0-4b6c-b68a-784b04ad906f` | `1feee250-1f42-4686-8614-d5064bcc5c8f` | None | 0 |
| 5 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\enforcement-validation-1780271579886.sqlite` | TEST_DB | 2026-05-31T23:53:31.077Z | `8abb93ec-a138-4dfe-b661-b6b6234f3c0f` | `30612bc4-0503-49d3-9f8d-cd984bae487f` | `13a5f49a-e989-41d0-a9c7-af3735654f9b` | `7db41567-0fe4-407d-8067-ceffb04e1376` | None | 0 |
| 6 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\enforcement-validation-1780268503331.sqlite` | TEST_DB | 2026-05-31T23:02:02.815Z | `ecc4becf-52d6-4232-91de-56a40e7c846c` | `56898302-f7da-4be1-8cfc-17de3837c55c` | `e06fb9d7-701c-4513-be2a-489664ee1584` | `2d7136e5-4e0f-4e96-9993-c23b5305324e` | None | 0 |
| 7 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\enforcement-validation-1780268374304.sqlite` | TEST_DB | 2026-05-31T22:59:53.068Z | `a2ce04df-a637-4908-a654-b13e0adee88b` | `b7dc5c3c-c891-4fb9-92cf-658dc78719fd` | `285ced3e-226c-4ba4-8875-9062e0566a07` | `8f1a294f-6454-49f8-af5b-187982fe96af` | None | 0 |
| 8 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\repro-sport-delete-1780268353117.sqlite` | TEST_DB | 2026-05-31T22:59:19.200Z | `3f62418e-c4f8-4435-b813-a8255745c4ab` | None | None | None | None | 0 |
| 9 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\repro-sport-delete-1780268168665.sqlite` | TEST_DB | 2026-05-31T22:56:17.602Z | `e7adfc6e-eac2-4028-a7ae-4c210adee2d6` | `c2a1e0f0-afdc-4f94-b35b-1bd0ea649362` | None | None | None | 0 |
| 10 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\repro-sport-delete-1780268126741.sqlite` | TEST_DB | 2026-05-31T22:55:35.021Z | `6b40b48f-beec-4d10-819b-d5901a96bfc8` | `6919b26c-eb80-4704-8a6a-3ef7b331c380` | `5ba63efe-11f8-4174-abf4-561fe998f179` | `246be6b9-77f5-4836-a9c6-2d5afb6e70de` | None | 0 |
| 11 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\repro-sport-delete-1780268053332.sqlite` | TEST_DB | 2026-05-31T22:54:25.048Z | `a0cefc8f-0138-4858-8d8f-a934287091e1` | `4cdb8cb4-e961-4432-b962-ed5ccab1d702` | `b3fedb50-65d3-46e5-915b-7a54136b2f87` | `28985b24-c8bc-44df-b1f7-f683f5d4076f` | None | 0 |
| 12 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\enforcement-validation-1780267841260.sqlite` | TEST_DB | 2026-05-31T22:51:10.232Z | `f51fd7ae-f31d-4b1d-b365-ad51228bb104` | `50afafb0-173f-47f1-b91b-9ad4c718c2a5` | `1bc9c9a6-5913-405c-ad90-ba614834f9fa` | `28298ae6-387a-4d3a-9c64-fa0db013cce9` | None | 0 |
| 13 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780089733414.sqlite` | TEST_DB | 2026-05-29T21:27:47.890Z | `6fcb1dac-4aa4-4c46-b54c-d96632052f20` | `09f8d81e-f638-4bf6-811b-9b35bd3e4f52` | `51d403ec-2394-45f9-bd0e-d8e54b3d8b38` | `1fd31f53-2bae-488b-941b-e96074c5e9f4` | `1f2993b5-3ef8-4889-a456-7b08df4d1553` | 111 |
| 14 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780089339815.sqlite` | TEST_DB | 2026-05-29T21:21:21.576Z | `a8b105c4-c8bb-4d45-acbb-ee0b35d962a9` | `c3a2ee77-707d-4e47-9351-103efe9a6a18` | `73c2553b-37c8-4d10-8beb-31c2d3c91550` | `8af88807-47b4-40e0-b0f1-1f4fbac1ccbe` | `dc38cd48-72c2-4a46-b05a-d19956229759` | 111 |
| 15 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\production-validation-1780089268775.sqlite` | TEST_DB | 2026-05-29T21:15:17.343Z | `6c021929-1577-4038-9a5a-ca1e7177ddf0` | `2341f1e3-374f-4d57-b2dc-7b292a986c22` | `cf7daabe-0b9b-4fbd-b33a-a6f21cc07a5d` | `b9b0a933-80cf-40db-afc4-8fdc77dd6eeb` | `650ffe8b-3abb-4d84-b290-168683b6a6f3` | 12 |
| 16 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\production-validation-1780088144031.sqlite` | TEST_DB | 2026-05-29T20:56:44.569Z | `fce960bd-ec95-4311-a30a-265cde56db46` | `457bdb55-34bc-462f-8529-07b2f04cc578` | `8a45de13-24d8-485a-b5b3-a67eb86e134a` | `1880524c-90e7-4348-adb9-b6035ad6e7fa6` | `d3dcb117-2e9a-47ec-bd08-d8b59072855f` | 12 |
| 17 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\production-validation-1780086891842.sqlite` | TEST_DB | 2026-05-29T20:35:27.695Z | `97b0f5d1-05c5-4f74-b3c1-229c29f71954` | `19d23e75-5bb1-4311-b202-579297d42dc5` | `2d9a63cd-05a1-40d1-b01b-b363aed667b3` | `b9cf5436-762a-4ca6-a680-16cff12112dc` | `7bad8b37-06b8-461b-a60d-7ea6c734b627` | 12 |
| 18 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\production-validation-1780086769467.sqlite` | TEST_DB | 2026-05-29T20:33:49.305Z | `1fcbf260-d9b4-459b-acfc-3b2ffc4a73c5` | `c72b0994-8dd3-4509-8b88-0524c58dc857` | `088003e6-ea3a-4609-9d87-49325f3b6290` | `e27d277c-d4b3-49d5-8427-6c34c1c4469d` | `7bfeb149-2bce-4045-9d8b-1650a3951a33` | 12 |
| 19 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780086937497.sqlite` | TEST_DB | 2026-05-29T20:41:02.887Z | `46b971c1-6ca7-4e0e-9301-1cefdd0745ee` | `ee68075f-aa9c-4655-9d1a-c5c74b9d20de` | `dda8cb93-a5fc-454b-a8b3-643bfe82672b` | `03f8d164-5bf9-436b-bdec-653d9f448847` | `cd4131c5-abdb-4391-b9ce-502aa8d7b2de` | 111 |
| 20 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780085352944.sqlite` | TEST_DB | 2026-05-29T20:18:54.714Z | `a5fcc0a5-1d1c-47e8-95cd-653b54efc132` | `c2cf9bb0-c6ce-4243-a976-098b7c1f4da6` | `b16f7f64-ec49-4959-961e-dbe084705179` | `ac6a621b-bbec-4f37-b72f-1338b5f9685d` | `8908b174-31b6-453b-829b-3241f1ea427c` | 111 |
| 21 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780084939212.sqlite` | TEST_DB | 2026-05-29T20:06:27.111Z | `59c0fcda-d91c-4c47-85c9-669974e51d22` | `2436f4c0-9333-4acc-ab06-244eb93180fc` | `eab0b4c7-3c47-4cf9-b5f3-ecde256928e2` | `f052268f-d488-4a5b-9329-095b67d9ce4d` | `9a264ca3-db0d-4400-af8f-a70ebb0a6484` | 61 |
| 22 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\stress-validation-1780084502414.sqlite` | TEST_DB | 2026-05-29T20:00:02.115Z | `a8c74dfa-7c6d-4925-bef7-7f843903b508` | `15f35db3-6487-4e03-a854-781055f84716` | `4c70e9cd-b8f1-419b-9774-592892eb1628` | `8228533f-1dde-47d1-8a8b-db50cb67aa34` | `3d3312f4-4228-4527-8b80-bdc974b51755` | 36 |
| 23 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\production-validation-1780078604176.sqlite` | TEST_DB | 2026-05-29T18:16:44.477Z | `7dc93628-6059-4fd2-bdbd-9562142afbbf` | None | None | None | None | 0 |
| 24 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend\tmp-phase6a-audit.sqlite` | TEST_DB | None | None | None | None | None | None | 0 |
| 25 | `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\node_modules\@gito\backend\tmp-phase6a-audit.sqlite` | DUPLICATE_DB | None | None | None | None | None | None | 0 |

## 3. Determinations

### A. Most recent operator activity

- `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\data\gito.sqlite` has the newest operator activity overall.
- The latest event is a provider add with `created_at=2026-06-01T16:55:29.182Z`.

### B. Currently published stream records

- The most recent published stream record is in `c:\Users\Utilisateur\Desktop\APPS\Stream\GiTO Live Sports\apps\backend\data\gito.sqlite`.
- That stream is `a3a8d413-1783-4102-9755-2bcb664f6824` published at `2026-06-01T16:04:47.413Z`.
- The duplicate `node_modules\@gito\backend\data\gito.sqlite` contains the same published stream state.

### C. IPTV provider used in the last successful live broadcast

- The last successful live broadcast is associated with the latest published stream in `apps\backend\data\gito.sqlite`.
- Therefore the relevant provider and broadcast record live in `apps\backend\data\gito.sqlite`.

### D. Active working database

- The backend configuration and startup path resolution target `data\gito.sqlite` in the repository root.
- That file is the operator database and should be considered the active working database.
- `apps\backend\data\gito.sqlite` is a stale/test artifact with duplicate entries also present in `node_modules\@gito\backend\data\gito.sqlite`.

## 4. Notes

- `data\gito.sqlite` contains the operator's most recent add/edit activity but fewer published stream rows than the test artifact.
- `apps\backend\data\gito.sqlite` contains the most recent published stream and match activity, which is why it appears active in records, but it is not the intended backend-open operator DB in the repository.
- `apps\backend\tmp-phase6a-audit.sqlite` and `node_modules\@gito\backend\tmp-phase6a-audit.sqlite` contain no provider/sport/competition/match/stream records relevant to this activity audit.
