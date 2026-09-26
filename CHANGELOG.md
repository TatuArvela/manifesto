# Changelog

## [0.4.0](https://github.com/TatuArvela/manifesto/compare/v0.3.1...v0.4.0) (2026-09-26)


### Features

* **client:** title the tab by instance alone, and keep its icon in dark mode ([#64](https://github.com/TatuArvela/manifesto/issues/64)) ([36f60ae](https://github.com/TatuArvela/manifesto/commit/36f60ae7c269a2382c332349ded359b8621498fd))

## [0.3.1](https://github.com/TatuArvela/manifesto/compare/v0.3.0...v0.3.1) (2026-09-26)


### Bug Fixes

* **client:** mobile editing and dragging, a loading screen, and instance branding ([#62](https://github.com/TatuArvela/manifesto/issues/62)) ([0fb19a9](https://github.com/TatuArvela/manifesto/commit/0fb19a99b1fcb71b82fa244e8fa1e2746b6b1542))

## [0.3.0](https://github.com/TatuArvela/manifesto/compare/v0.2.1...v0.3.0) (2026-09-25)


### Features

* tabbed settings modal with account pages, and one export zip in both modes ([#60](https://github.com/TatuArvela/manifesto/issues/60)) ([b80b6ae](https://github.com/TatuArvela/manifesto/commit/b80b6aeee622bbf02f1cc1010b370a95470d2535))

## [0.2.1](https://github.com/TatuArvela/manifesto/compare/v0.2.0...v0.2.1) (2026-09-24)


### Bug Fixes

* **client:** resolve stored link preview images on the board ([#58](https://github.com/TatuArvela/manifesto/issues/58)) ([895d48b](https://github.com/TatuArvela/manifesto/commit/895d48b6c57575cf1b7815c4c78a45e13700fafe))

## [0.2.0](https://github.com/TatuArvela/manifesto/compare/v0.1.8...v0.2.0) (2026-09-24)


### ⚠ BREAKING CHANGES

* POST and PUT /api/notes refuse a data: URL in a link preview's image or favicon. Migration 0014 empties link_previews on any note still holding one inline.
* **server:** POST and PUT /api/notes refuse data: URLs in images; upload each image to POST /api/attachments and send the reference.

### Features

* an audit log for admins ([04d639e](https://github.com/TatuArvela/manifesto/commit/04d639e07b1b1d39590ef4628584194f3226ecd9))
* an overview page for admins ([9e127bf](https://github.com/TatuArvela/manifesto/commit/9e127bfc548af5bfaf4eb9c484d8b0f96c8ab42d))
* **client:** add grid columns on screens wider than 1920px ([76b3989](https://github.com/TatuArvela/manifesto/commit/76b398929562f7f9b41a44a5dbe5f1c330d2895f))
* **client:** add keyboard shortcuts to the board ([5cdd693](https://github.com/TatuArvela/manifesto/commit/5cdd69385eac0780884ed85bf3138d656c6d5725))
* **client:** add playful board textures ([6897503](https://github.com/TatuArvela/manifesto/commit/689750399a7e39d4e3341c02901a7a0620941463))
* **client:** debounce the search field ([c4450a0](https://github.com/TatuArvela/manifesto/commit/c4450a0dffba2d65c23bd617bfde5e672cf3b2fa))
* **client:** ease out of select mode ([bb4c8dc](https://github.com/TatuArvela/manifesto/commit/bb4c8dc71d7bb4b3e8a59c8d3a831914d34cd469))
* **client:** import a folder of Markdown notes ([253544d](https://github.com/TatuArvela/manifesto/commit/253544d26991bbe92ca529b5924944e1d003e7a5))
* **client:** import Google Keep notes from Takeout ([19b754a](https://github.com/TatuArvela/manifesto/commit/19b754a72aa22293c1d25cb574e216b7401a81a9))
* **client:** keep open-mode images in IndexedDB ([c712121](https://github.com/TatuArvela/manifesto/commit/c712121de9a91e56b5d02a4b270bf49569da722e))
* **client:** lay auto-note plugins out in columns in grid mode ([69dc591](https://github.com/TatuArvela/manifesto/commit/69dc591156c385c7cccb442d0491a627d6b305c2))
* **client:** let the top bar scroll away on phones ([97935d9](https://github.com/TatuArvela/manifesto/commit/97935d95ee54f3d5a0f443818406caadb92bf159))
* **client:** offer a random board colour ([1f2f8cd](https://github.com/TatuArvela/manifesto/commit/1f2f8cd2d500c535baf200159c6c844f4fa4c9c2))
* **client:** offer a random board texture ([38c6a02](https://github.com/TatuArvela/manifesto/commit/38c6a02fbabbb2f3e90b6a70540ede1513febdf2))
* **client:** offer small notes in the grid ([5530581](https://github.com/TatuArvela/manifesto/commit/553058110e71416d8283d7b331bfb418c879cf21))
* **client:** preview the new order while a note is dragged ([ecc97fb](https://github.com/TatuArvela/manifesto/commit/ecc97fbdac7103faf8e84c32d87469169b18be16))
* **client:** put the empty board's message on a card ([a880ea2](https://github.com/TatuArvela/manifesto/commit/a880ea2d8ae3b191a65ba055b7499caebb9e839f))
* **client:** receive shares from other apps ([bd0ce8e](https://github.com/TatuArvela/manifesto/commit/bd0ce8e63075f63b994fa637bd803bbf82eda6c4))
* **client:** tag counts, renaming, and hiding a tag from the Notes view ([9d9785a](https://github.com/TatuArvela/manifesto/commit/9d9785a3f654d6a45c7435a3fccde60438b04549))
* compose files in the repository ([a7946a9](https://github.com/TatuArvela/manifesto/commit/a7946a9014894e9930eb6f4d39dfaba29643f97f))
* download an account's notes from the server ([375b4a0](https://github.com/TatuArvela/manifesto/commit/375b4a0a60ec33d219ad7ebe45db783f261b54f7))
* hide Create account when the server does not allow it ([ec94db6](https://github.com/TatuArvela/manifesto/commit/ec94db62032b27d4e0d26f749fb43736266418cd))
* keep connected-mode images outside the note row ([c15ebcc](https://github.com/TatuArvela/manifesto/commit/c15ebcc2d3b3fca67f9b077ef50e4c34c27b14ef))
* keep version history on the server in connected mode ([0c2e6f9](https://github.com/TatuArvela/manifesto/commit/0c2e6f9268c49ad215793a72b100b724c5206a2e))
* offer local and single sign-on side by side ([5ddd864](https://github.com/TatuArvela/manifesto/commit/5ddd864b4e7bc546674c84f8d2ee5048580ea9dd))
* one container that serves the client too ([b917295](https://github.com/TatuArvela/manifesto/commit/b917295311ed829dfa2ac900e4a54b6fbd88ad15))
* password reset and share invitations by mail ([ccd0148](https://github.com/TatuArvela/manifesto/commit/ccd0148b02823ee08cb8b866451e8ac13f44857a))
* personal API tokens ([21b1383](https://github.com/TatuArvela/manifesto/commit/21b138385390239d804f4b960c3ca64f92431043))
* put new and newly pinned notes at the head of the board ([39c47c2](https://github.com/TatuArvela/manifesto/commit/39c47c2039a73c97c955e4fa90e055831dfc494e))
* **server:** a Prometheus metrics endpoint ([22ec130](https://github.com/TatuArvela/manifesto/commit/22ec1307398d682407e13289235b42e557e4a94c))
* **server:** an admin CLI for lockout recovery ([e93720b](https://github.com/TatuArvela/manifesto/commit/e93720b7391c7143b388c58d5331861b45fa02dc))
* **server:** map an OIDC group to admin, and gate sign-up ([ba8aac5](https://github.com/TatuArvela/manifesto/commit/ba8aac5bdad33b7793ba148d8291c8a9b157e27e))
* **server:** publish an OpenAPI document ([23ef202](https://github.com/TatuArvela/manifesto/commit/23ef2022ab4660079c856efe8e4d09e2d85553b1))
* **server:** read secrets from files ([b157ec4](https://github.com/TatuArvela/manifesto/commit/b157ec46be0fec523c3e997b7e34b0118af538d6))
* **server:** search notes from a word index ([dfe54db](https://github.com/TatuArvela/manifesto/commit/dfe54db1c0ea9156be8293432cb0aa59938e3686))
* **server:** serve metrics on a port of their own ([f307b30](https://github.com/TatuArvela/manifesto/commit/f307b30145dac89ae4a4967df315252f9ad083cf))
* **server:** take scheduled SQLite backups ([27b65d5](https://github.com/TatuArvela/manifesto/commit/27b65d570389175317efb75bcc977d4dce8ac36b))
* shrink large photos on attach and raise the image limit to 5 MB ([a46ceda](https://github.com/TatuArvela/manifesto/commit/a46ceda205c920fb3b64e501986a93d2fec078ff))
* store link preview images as attachments ([aedfb98](https://github.com/TatuArvela/manifesto/commit/aedfb98cd66c6ca6b6fad21c22b76ffb5e6162fe))
* tell admins when a newer release is out ([12d6388](https://github.com/TatuArvela/manifesto/commit/12d638840afb9052f50fabfc00de9bf9c6d87a46))
* two-factor sign-in for local accounts ([f0d8ca3](https://github.com/TatuArvela/manifesto/commit/f0d8ca36bb326aae24d1bf5a256b545e206d95b1))
* upload images separately in connected mode ([a2b934b](https://github.com/TatuArvela/manifesto/commit/a2b934bcce8ac690e16be135de0f161e9f8d8247))
* webhooks for note events ([829465d](https://github.com/TatuArvela/manifesto/commit/829465d37321a3f1e911c55d8f9a81f868287aaf))
* write share invitations in the recipient's language ([6d8d929](https://github.com/TatuArvela/manifesto/commit/6d8d929dd16d63a6ca85e7ef9b7375f01c6ac839))


### Bug Fixes

* **client:** animate dropdowns and card popovers out ([514dd7f](https://github.com/TatuArvela/manifesto/commit/514dd7f20884419c75dcf025fcfcb2566f9f049e))
* **client:** close the editor the way it opened ([24d8b06](https://github.com/TatuArvela/manifesto/commit/24d8b065e411445b4fbb3303d0e9515b249bbe71))
* **client:** keep the auto-notes add form at the top ([8ebde67](https://github.com/TatuArvela/manifesto/commit/8ebde67078fbedadce0054345808eab30abf63ef))
* **client:** let the Settings panel leave at speed ([5eec3c3](https://github.com/TatuArvela/manifesto/commit/5eec3c3dc824327e6a785cfcbbdd276685a08d19))
* **client:** load the board when an open-mode image cannot move ([6465348](https://github.com/TatuArvela/manifesto/commit/64653489505393e1049059d32e8605f7d1483f9c))
* **client:** open the reminder picker from a card's menu ([bd63ec6](https://github.com/TatuArvela/manifesto/commit/bd63ec6faffedfe836a6b68bd2ead8b9c8ab52f1))
* **client:** put image bytes in the composer download and crash backup ([889e4d1](https://github.com/TatuArvela/manifesto/commit/889e4d1bdb928341583e637103b76661bc52b734))
* **client:** restore an account download from its notes.json ([29615db](https://github.com/TatuArvela/manifesto/commit/29615db4de897818a4c1386e856877b002f9b7a6))
* **client:** stop a just-pinned card leaving a gap under it ([c503dcf](https://github.com/TatuArvela/manifesto/commit/c503dcfc8d196583aee938f17a0519569673b65a))
* **client:** stop an image upload once its editor has closed ([e5f6d04](https://github.com/TatuArvela/manifesto/commit/e5f6d04415c478345d7e4f79c613433a932205e8))
* **client:** wait for the first load before saying the board is empty ([360e5f5](https://github.com/TatuArvela/manifesto/commit/360e5f5205f1620c11d6d6018a0dce8e8bf6a569))
* leave OIDC admin as it was when the groups cannot be read ([79a5819](https://github.com/TatuArvela/manifesto/commit/79a5819d81d1896f431e6346c088436dea81947f))
* restart an image's grace when it is stored again ([f56ff46](https://github.com/TatuArvela/manifesto/commit/f56ff469eff0c37dadf0108118f9a2ea83261faa))
* **server:** hand the update check's answer to the admin routes ([1414214](https://github.com/TatuArvela/manifesto/commit/1414214c793246dd05761aba07bda2ba788cc9ba))
* **server:** keep scheduled backups from crowding the disk ([4d861d0](https://github.com/TatuArvela/manifesto/commit/4d861d0a19e11c81079c7787df78f26137091bbe))
* **server:** recognise an AVIF that lists its brand as compatible ([0be9501](https://github.com/TatuArvela/manifesto/commit/0be950148618976690cae94f695bb0e06a34366b))
* **server:** run a job with a long interval at that interval ([faf095c](https://github.com/TatuArvela/manifesto/commit/faf095c3eaaaf3cb0042e2af6b5c0fd6522eed2a))
* **server:** store an upload as the image type its bytes show ([a50c403](https://github.com/TatuArvela/manifesto/commit/a50c403160a066d2804e8ba1f785e315d3f27057))
* silenced errors, duplicate imports and same-origin admin; note state split up ([#57](https://github.com/TatuArvela/manifesto/issues/57)) ([38bafa2](https://github.com/TatuArvela/manifesto/commit/38bafa2d621834fbe255279934a42cd3fe1bf46f))


### Reverts

* **server:** take the word index out of search ([7d454d0](https://github.com/TatuArvela/manifesto/commit/7d454d0b8ba3451c7b76fab2efad05be894c022b))


### Code Refactoring

* **server:** take image references only in note writes ([4398763](https://github.com/TatuArvela/manifesto/commit/4398763f3ea92f80fd922335852d5398a03f55c4))

## [0.1.8](https://github.com/TatuArvela/manifesto/compare/v0.1.7...v0.1.8) (2026-09-22)


### Features

* **client:** greet with "This is Foo" and drop the unbranded variant ([3f7e3b9](https://github.com/TatuArvela/manifesto/commit/3f7e3b90a1d92f014505abbbc004e23807fcb861))
* **client:** let a release bundle be pointed at a server ([ea14f34](https://github.com/TatuArvela/manifesto/commit/ea14f34177e382c4d24557e9e58ba5fb34a06e55))
* notice an app socket that died without a close ([6ad08f6](https://github.com/TatuArvela/manifesto/commit/6ad08f6c48f3fec19fda0b553c33ecd75f306313))


### Bug Fixes

* **client:** make a same-origin server URL actually reach the server ([deebcf2](https://github.com/TatuArvela/manifesto/commit/deebcf22de9f77ed97130077076f1b98e5350668))
* **client:** make the pin readable on a card that is all picture ([eddb065](https://github.com/TatuArvela/manifesto/commit/eddb0656d8d6a1a9e707700d86d6974ec1ebb0f0))
* **client:** show a checklist row's delete button on a touch screen ([eccd7ff](https://github.com/TatuArvela/manifesto/commit/eccd7ff595087d903d8cdbef4a0f74f7aad4fa87))
* **client:** stop announcing a lost connection on every resume ([ca90d79](https://github.com/TatuArvela/manifesto/commit/ca90d79fbbef988065de208a52853885d57138c9))
* **client:** stop the outage banner from redialling the socket ([8ad29c3](https://github.com/TatuArvela/manifesto/commit/8ad29c31a95288c2a2ca86c487277231fe01af87))
* **server:** make sign-in throttling hold against IPv6 and timing ([3e9bc72](https://github.com/TatuArvela/manifesto/commit/3e9bc72f89f9d1f46644d223b14d500d81ccfc7c))


### Performance Improvements

* **client:** give a dropped note a number of its own ([e9dd60f](https://github.com/TatuArvela/manifesto/commit/e9dd60f0680010cdc3b7d2750540fe57ef89b1f2))
* **client:** keep each note's version history under its own key ([8605292](https://github.com/TatuArvela/manifesto/commit/86052922f5b1b6826efaef7579194b200fdf6490))
* **client:** let a connected board change on the click, not on the reply ([e79851e](https://github.com/TatuArvela/manifesto/commit/e79851e3064c3f511df0c623b9a5cc91bc013692))
* **client:** re-span only the masonry card that resized ([4f2d830](https://github.com/TatuArvela/manifesto/commit/4f2d830d656dfc44622c7b11e4be45a3170dd88f))
* **client:** stop parsing the whole note list on every open-mode write ([5201de0](https://github.com/TatuArvela/manifesto/commit/5201de03558768415258ac4ff360ca74e4967ee2))
* **client:** stop re-rendering every card for one card's change ([f017750](https://github.com/TatuArvela/manifesto/commit/f0177505dd498ce5f71d99083423eba7ba0de35a))
* **client:** trim per-frame work on cards, sorting and dragging ([560ff35](https://github.com/TatuArvela/manifesto/commit/560ff3598210b62010858e0f98ae7e680d8e7336))

## [0.1.7](https://github.com/TatuArvela/manifesto/compare/v0.1.6...v0.1.7) (2026-09-20)


### Features

* **client:** animate archived and restored cards out of the grid ([8a04989](https://github.com/TatuArvela/manifesto/commit/8a04989f0dadd8c69d0641cb69cd525f9dde8b72))
* **client:** compose a board background ([0cf1c40](https://github.com/TatuArvela/manifesto/commit/0cf1c40a68e92772163b7ef9778d984410b2406d))
* **client:** confirm deletions, and polish the phone experience ([2928e63](https://github.com/TatuArvela/manifesto/commit/2928e63715ec0e3ac5632384807d1735b1a12c90))
* **client:** give tags a button of their own ([c925ffc](https://github.com/TatuArvela/manifesto/commit/c925ffc9e6ea45266e9e777e23ffff105cc0b231))
* **client:** grow the editor out of its note ([b48d168](https://github.com/TatuArvela/manifesto/commit/b48d16894104a61d31d677918beb6e3fc4ab74c3))
* **client:** larger editor controls on phones, wrapping when narrow ([12751a8](https://github.com/TatuArvela/manifesto/commit/12751a81fe4533efa892cb8b8b77a055afca1a32))
* **client:** update an installed app without losing work ([5e1ef13](https://github.com/TatuArvela/manifesto/commit/5e1ef1372ea9b5419707f5e2f6f065ee107d23d4))
* give share recipients a trash of their own ([c5a43fa](https://github.com/TatuArvela/manifesto/commit/c5a43faa1070b664f1b0cb583a107cf300990330))
* share notes with other accounts ([a9460d7](https://github.com/TatuArvela/manifesto/commit/a9460d7a99b0439718b825a2d31ce52384775121))


### Bug Fixes

* **client:** keep a keystroke typed as a raw-mode note opens ([97ad299](https://github.com/TatuArvela/manifesto/commit/97ad299d181b94d9d70e3afca8dfdb776e64a29b))
* **client:** let a dropdown's own button close it on a phone ([88c6bc1](https://github.com/TatuArvela/manifesto/commit/88c6bc1282f9c53d655e24ce42f063992a62e4ba))
* **client:** let only the newest focus trap handle Tab ([e50d04c](https://github.com/TatuArvela/manifesto/commit/e50d04c6493cb183355ebd704d4527c77b9a2e6c))
* **client:** show reminders as notifications on phones ([79b879b](https://github.com/TatuArvela/manifesto/commit/79b879bfa4b68e1b0ada7fdf0d068a2e9d4a16ce))
* **server:** allow If-Match through CORS ([598db5c](https://github.com/TatuArvela/manifesto/commit/598db5ca1522d36a629a79521286718e62845ba1))

## [0.1.6](https://github.com/TatuArvela/manifesto/compare/v0.1.5...v0.1.6) (2026-09-13)


### Features

* add serif, monospace and script note fonts ([b96a587](https://github.com/TatuArvela/manifesto/commit/b96a587508211354049bde3ba8fa69d9da323daf))
* **client:** a Users view for admins, and changing passwords ([6ddae2c](https://github.com/TatuArvela/manifesto/commit/6ddae2cba4250aff8349a06ba2e1b1133648310a))
* **client:** drop the "Sign in to" line from the login screen ([4123f8e](https://github.com/TatuArvela/manifesto/commit/4123f8e1a02570640c3102416f9494a0baf2cd9a))
* **client:** keep note fonts and the logo available offline ([bf5a6dd](https://github.com/TatuArvela/manifesto/commit/bf5a6dda4cc6ab6c6798306c018ac99db462c409))
* **client:** let any color be the default for new notes ([6fede22](https://github.com/TatuArvela/manifesto/commit/6fede226cfafda0794054b6807dd14905738da04))
* **client:** move account actions to a menu in the header ([cd284c3](https://github.com/TatuArvela/manifesto/commit/cd284c3d284b71fbb7532a2cad607d2d0ec63eed))
* **client:** say the app's name properly in an unbranded welcome ([337f3df](https://github.com/TatuArvela/manifesto/commit/337f3df4946a7fe3b09350b986a23043fdd1d3dc))
* **client:** serve the note fonts from our own origin ([5c29b7c](https://github.com/TatuArvela/manifesto/commit/5c29b7c10c973de1651ba8b3257ae8265fc37d87))
* **server:** admins, temporary passwords and account management ([c551aef](https://github.com/TatuArvela/manifesto/commit/c551aefcb14f03f08d4deb466adc3ef8386143b0))
* **server:** create the initial admin with a printed temporary password ([9effed7](https://github.com/TatuArvela/manifesto/commit/9effed7b86b6e0245bd07a4f286027646dd575f9))


### Bug Fixes

* **client:** let the new-note keyboard open on a phone, and stay shut on close ([e41bec5](https://github.com/TatuArvela/manifesto/commit/e41bec5843f97faa54840f35ece4d283130fc82f))
* report the real build version between releases ([b5de696](https://github.com/TatuArvela/manifesto/commit/b5de696a2ef89c4c52aebd5bb44c56adc355b35f))

## [0.1.5](https://github.com/TatuArvela/manifesto/compare/v0.1.4...v0.1.5) (2026-09-13)


### Features

* **client:** animate a note's card out when it is deleted ([8bd205d](https://github.com/TatuArvela/manifesto/commit/8bd205d7b131a5d7ac15006d07d8978d8ffc424d))
* **client:** clear the selection on a click on empty grid space ([796da08](https://github.com/TatuArvela/manifesto/commit/796da082d32532a739d6cbd7efab9ac2b36e98d6))
* **client:** fill in link previews from the server in connected mode ([fc86b22](https://github.com/TatuArvela/manifesto/commit/fc86b224e79ee0df228f70076d5bc67cb410f593))
* **client:** let Done add an empty note ([9817878](https://github.com/TatuArvela/manifesto/commit/9817878e5939b9256eee4e204e536d44c6fc5c07))
* **client:** let raw mode be the default edit mode ([678e557](https://github.com/TatuArvela/manifesto/commit/678e557e3ade1a632153701fb66878d648998561))
* **client:** let the formatting toolbar be hidden ([3497cdc](https://github.com/TatuArvela/manifesto/commit/3497cdcd6cdf6121bda89295de43b846e5d85639))
* **client:** open editor links from a button, not a click ([7bc1d07](https://github.com/TatuArvela/manifesto/commit/7bc1d07f12ffb1c41f2238968e4205bec13efa68))
* **client:** open links in notes in a new tab ([cdbbaa4](https://github.com/TatuArvela/manifesto/commit/cdbbaa473b52dfa731451485b5165db1fb112090))
* **client:** select notes by dragging a box over the grid ([c5ed182](https://github.com/TatuArvela/manifesto/commit/c5ed18231a8b915273ce347e74cac8120f6b71c3))
* **client:** welcome first-time visitors and say where notes are saved ([8e41414](https://github.com/TatuArvela/manifesto/commit/8e4141485001475557f93ab2627fc553f9825ea6))
* **server:** fetch link preview metadata for connected clients ([e9f86c7](https://github.com/TatuArvela/manifesto/commit/e9f86c7e4a7f3ca0b2992218636be7815198e4d0))


### Bug Fixes

* **client:** fill square cards that hold only a link or images ([5be3c5c](https://github.com/TatuArvela/manifesto/commit/5be3c5cbb373478d9306f701d23b9a40e54528c7))
* **client:** keep checklist text clear of the delete button ([19b177a](https://github.com/TatuArvela/manifesto/commit/19b177a048eff308fec95a73decdb19862806668))
* **client:** make the toolbar edit raw mode's markdown ([8b12cc6](https://github.com/TatuArvela/manifesto/commit/8b12cc6535f0b8957cc037b154d816747875a78e))
* **client:** recognise raw-mode markers inside the selection ([c56b1ae](https://github.com/TatuArvela/manifesto/commit/c56b1ae17f6c09e3583a9093a2000312f8bf06da))
* **client:** stop a caret inside bold markers lighting up Italic ([59bc039](https://github.com/TatuArvela/manifesto/commit/59bc039b6e80b1bc8216692cda8376ac8aaf8803))
* **client:** stop keyboard focus landing on invisible controls ([991bb37](https://github.com/TatuArvela/manifesto/commit/991bb379836a0d68c5041b696945eca531c47ba2))
* **client:** stop the new-note stack stretching after a view switch ([c372e77](https://github.com/TatuArvela/manifesto/commit/c372e77eaf072ef47969260add1d53b8ca3ed8bd))

## [0.1.4](https://github.com/TatuArvela/manifesto/compare/v0.1.3...v0.1.4) (2026-09-12)


### Bug Fixes

* **server:** copy shared in whole before installing in the image build ([2d4cb60](https://github.com/TatuArvela/manifesto/commit/2d4cb604ad25609fd78b9c6f4d8c85a6f731f6ea))

## [0.1.3](https://github.com/TatuArvela/manifesto/compare/v0.1.2...v0.1.3) (2026-09-12)


### Features

* **client:** add a dark shade and a quips toggle, grouped into sections ([2b2fc10](https://github.com/TatuArvela/manifesto/commit/2b2fc10d8ba07a307885f330576f19213198cede))
* **client:** add a rounded / straight note corner option ([bf5c601](https://github.com/TatuArvela/manifesto/commit/bf5c6016508598cde7f93c340e59114fb0231f8a))
* **client:** add an animations toggle, defaulting to the OS motion setting ([28f8a31](https://github.com/TatuArvela/manifesto/commit/28f8a31f72da6fc17b24a10a9f8500fff3e4b106))
* **client:** add an error boundary so a bad note can't white-screen the app ([b159872](https://github.com/TatuArvela/manifesto/commit/b1598729b4ba97742d002b2d5c573f4ec4efe79a))
* **client:** animate the selection outline, and peel the sheet downward ([9372c3a](https://github.com/TatuArvela/manifesto/commit/9372c3a37797bd0a014feae86876f32fcda7f341))
* **client:** close the new note editor with Escape ([f60629f](https://github.com/TatuArvela/manifesto/commit/f60629fddad5440bfb13545f9a27682a5b3c8650))
* **client:** exit search with Escape ([e0fa88c](https://github.com/TatuArvela/manifesto/commit/e0fa88c118566c1ab2ee89698fd3a1ecbfbc108f))
* **client:** explain automatic notes on the empty plugins page ([17aa0ee](https://github.com/TatuArvela/manifesto/commit/17aa0ee10aeedff645e1417ec5f2cf7889a3ba87))
* **client:** give the note stack a paper texture ([ca8566e](https://github.com/TatuArvela/manifesto/commit/ca8566e88beafa6fa9d9b915ca5eca9381cf70be))
* **client:** make the grid keyboard-reachable and trap focus in modals ([c13b9b9](https://github.com/TatuArvela/manifesto/commit/c13b9b9685b6c2ffc7329a0c071d7c793bebdf2d))
* **client:** parametrize the product name, description and brand marks ([211529e](https://github.com/TatuArvela/manifesto/commit/211529e5381144235b452d2685b946a37f85e811))
* **client:** polish the search field ([4e2f2de](https://github.com/TatuArvela/manifesto/commit/4e2f2de352331e8e75e033b716ea0f202c428e12))
* **client:** rebuild the note stack peel and landing animations ([3c56368](https://github.com/TatuArvela/manifesto/commit/3c5636888e3203233d9d2c3be972d103ebcd7fbc))
* **client:** settle a note into place when it is pinned ([f40943b](https://github.com/TatuArvela/manifesto/commit/f40943b9839bb9889bb11549e1d2447def54c04e))
* **client:** show the brand mark on the login screen ([661f1d8](https://github.com/TatuArvela/manifesto/commit/661f1d8d9a534293db646ee492ecd6f283758f41))
* page the note listings and leave attachments out of them ([e036a8c](https://github.com/TatuArvela/manifesto/commit/e036a8c9da2414c6d4a486640eb8aff16af8e9f8))
* **server:** give sessions an absolute lifetime and reap expired ones ([bb42178](https://github.com/TatuArvela/manifesto/commit/bb42178be871dfdda4839044c96d03b6fb76e6d5))
* **server:** shut down gracefully on SIGTERM and SIGINT ([1e8f4dd](https://github.com/TatuArvela/manifesto/commit/1e8f4ddae591459e2afde31afdee3dd6e2e90be8))
* **server:** version the schema instead of re-running one CREATE blob ([e51d467](https://github.com/TatuArvela/manifesto/commit/e51d4676cd346332f6a552d07aa02a932261bc9d))


### Bug Fixes

* accept the images the client actually produces ([53a8532](https://github.com/TatuArvela/manifesto/commit/53a85329244bb5c5559c93afb361ab9391787387))
* **client:** bound the trailing-punctuation regex ([a6712d1](https://github.com/TatuArvela/manifesto/commit/a6712d1f13e2adeb0c44066278b932a7ee775cd9))
* **client:** centre the search filters in grid view as well as list ([19870a8](https://github.com/TatuArvela/manifesto/commit/19870a8a917051f06eb423fd8cd936d7737d8ff1))
* **client:** connect with @hocuspocus/provider ([971d320](https://github.com/TatuArvela/manifesto/commit/971d32093c7bf8273e695a5d396c1a23cd8628c6))
* **client:** disarm Milkdown's listener before destroying the editor ([552dafd](https://github.com/TatuArvela/manifesto/commit/552dafdb34b307927ed515d4acb90a5310c5b0e2))
* **client:** dismiss the trigger's tooltip when a panel opens over it ([30237f5](https://github.com/TatuArvela/manifesto/commit/30237f5a5c90da336dce2e5219b9b6d4d2ef7755))
* **client:** don't let an open tooltip swallow Escape ([e3ce36a](https://github.com/TatuArvela/manifesto/commit/e3ce36a802c2e3cc081bf78b0a84563bd00c0aa5))
* **client:** draw note selection as an outline so it can't reflow the grid ([9922296](https://github.com/TatuArvela/manifesto/commit/99222969274bf4d327c54e6de482c1da4d8febf8))
* **client:** fetch every attachment before writing an export ([149ecc1](https://github.com/TatuArvela/manifesto/commit/149ecc17d9e7b087e3aa9b0441e42eac2d3cd7b7))
* **client:** fix the note stack's open and close choreography ([9864d77](https://github.com/TatuArvela/manifesto/commit/9864d777f12195645b537bbe7da7cfbdab2fa1d2))
* **client:** flip dropdowns at the viewport edge, and place them without anchor positioning ([ce0f3bf](https://github.com/TatuArvela/manifesto/commit/ce0f3bf4b32d5a2f13872f6f6dc22d370d1fd57d))
* **client:** give Escape to one layer and let the signal close the modal ([1f76361](https://github.com/TatuArvela/manifesto/commit/1f76361ccd8677798d4a3bca57741772d5f5a214))
* **client:** install the collab plugin once the provider has synced ([26d7e7a](https://github.com/TatuArvela/manifesto/commit/26d7e7afc8f08c8f60777ac27158d3171014e259))
* **client:** keep checklist actions out of code fences ([bef08b4](https://github.com/TatuArvela/manifesto/commit/bef08b478323634a57a5841dfd9c2db999e28b0c))
* **client:** keep single-version histories when trimming under quota ([cc576ff](https://github.com/TatuArvela/manifesto/commit/cc576ff3ea6e0cce6d7876d43fe7d343ebe7263e))
* **client:** make the Fun Quips setting do something ([8746c0d](https://github.com/TatuArvela/manifesto/commit/8746c0deb88118c26f08880133806cc4563145c9))
* **client:** place card popovers with the same geometry as dropdowns ([842834a](https://github.com/TatuArvela/manifesto/commit/842834a9ed9f9573b6585139e5bc37f428ef4300))
* **client:** re-measure a card whose height settles after it is drawn ([0ff1fe3](https://github.com/TatuArvela/manifesto/commit/0ff1fe30baabb2f735dd687e1f2a1c93ed84d956))
* **client:** reveal the next sheet without cross-fading it ([6c1ab84](https://github.com/TatuArvela/manifesto/commit/6c1ab843c1363f93795ef8af644990ece166b0e6))
* **client:** round the note stack's sheets, not just the pad around them ([f8997f1](https://github.com/TatuArvela/manifesto/commit/f8997f14969043ab3fc9884c27c33b5cac8ee1fd))
* **client:** run plugins in a worker and validate their output host-side ([3d32016](https://github.com/TatuArvela/manifesto/commit/3d32016bde59fc621d4ce6807bc2144fe0f6a71d))
* **client:** sanitize inside renderMarkdown, not at each call site ([2725f2d](https://github.com/TatuArvela/manifesto/commit/2725f2db3e46923671b9f990456c5ec390e665d3))
* **client:** stop an image write erasing a note's attachments ([a6cfbb3](https://github.com/TatuArvela/manifesto/commit/a6cfbb308012a3b528e7e498e5ef09fcb1d205e5))
* **client:** stop dark code blocks wearing the inline-code background ([d308b3c](https://github.com/TatuArvela/manifesto/commit/d308b3cb242edac9a6d6ca6b0340be199f89eea7))
* **client:** stop dismissed reminders re-firing every minute ([116059d](https://github.com/TatuArvela/manifesto/commit/116059dbf180eefee4e5b0847e569be47212c0f2))
* **client:** stop dropdown panels rendering black text in dark mode ([d8ca4eb](https://github.com/TatuArvela/manifesto/commit/d8ca4eb2684dc33138955ea37213dbc208c40601))
* **client:** stop markdown rules running where they do not apply ([a87b046](https://github.com/TatuArvela/manifesto/commit/a87b046e034db4a89b606fa77f4a2eb136d7ba88))
* **client:** stop the editor overwriting a synced note on mount ([4ba315a](https://github.com/TatuArvela/manifesto/commit/4ba315ad47de5b918dbe38152acfe678802451ae))
* **client:** stop the note stack flashing full width on leaving search ([1406fa2](https://github.com/TatuArvela/manifesto/commit/1406fa214f9e5f7070abb5ddada9d966903707c3))
* **client:** stop the note stack lurching when the editor closes ([3abd512](https://github.com/TatuArvela/manifesto/commit/3abd5129e8acd284a8744e4b1755a36310269342))
* **client:** suppress the duplicate native clear button in the header search ([0d68deb](https://github.com/TatuArvela/manifesto/commit/0d68deb9ad24f352a978158b06103c707bf9d84d))
* **client:** sync tabs through storage events and type the network seams ([b5697b8](https://github.com/TatuArvela/manifesto/commit/b5697b848a6236125d3c70d8efc9c826bdf09553))
* **client:** validate every field on bulk import ([f0f773b](https://github.com/TatuArvela/manifesto/commit/f0f773beb181218cc8d2ffdaaeee360e61dfb152))
* make the advertised image size the one actually enforced ([31a6689](https://github.com/TatuArvela/manifesto/commit/31a668966e149ff971d77b2d482aa50e40233ab7))
* **server:** attach a socket error listener before the upgrade awaits ([ca730cc](https://github.com/TatuArvela/manifesto/commit/ca730cc5460e2960bb88c6ecebdd3ed4e3d371d7))
* **server:** bind the OIDC callback to its browser and throttle the router ([f0a3987](https://github.com/TatuArvela/manifesto/commit/f0a3987dbabdb9b1669e17fa3daab9cd6d8822cd))
* **server:** keep query strings out of the access log ([36093b9](https://github.com/TatuArvela/manifesto/commit/36093b9761edd530b4b4b511eff45c9c117200ee))
* **server:** read the socket and authorize the document that is joined ([b4e43d1](https://github.com/TatuArvela/manifesto/commit/b4e43d12cca8fca24371d12ec008ea85618d9a03))
* **server:** stamp trashedAt on the server rather than trusting the client ([186f60c](https://github.com/TatuArvela/manifesto/commit/186f60c84ea640c6ae9ccd382b766abe5071021a))


### Performance Improvements

* **client:** composite the settings panel slide so it doesn't stutter ([f64e684](https://github.com/TatuArvela/manifesto/commit/f64e684726754df7a5f6581ae65e7a0b79063a66))
* **client:** load the collaboration stack only in connected mode ([86adb90](https://github.com/TatuArvela/manifesto/commit/86adb90fc59717beb395539e7d8b7bdf57358e1c))


### Reverts

* **client:** restore the original search field styling ([7154f2d](https://github.com/TatuArvela/manifesto/commit/7154f2d9e13e50107b001fb70ef225b60c6bb94a))

## [0.1.2](https://github.com/TatuArvela/manifesto/compare/v0.1.1...v0.1.2) (2026-09-01)


### Bug Fixes

* **client:** dedupe optimistic note insert to stop duplicate cards ([#9](https://github.com/TatuArvela/manifesto/issues/9)) ([b32dde3](https://github.com/TatuArvela/manifesto/commit/b32dde33253808f12c69b893bb5443d41acd170c))
* **server:** build @manifesto/shared and pin the Docker build context ([#11](https://github.com/TatuArvela/manifesto/issues/11)) ([266866e](https://github.com/TatuArvela/manifesto/commit/266866ee138f933cd2dc33a4afa3a40519376b8a))

## [0.1.1](https://github.com/TatuArvela/manifesto/compare/v0.1.0...v0.1.1) (2026-08-31)


### Bug Fixes

* **server:** produce a working runtime image via pnpm deploy ([#7](https://github.com/TatuArvela/manifesto/issues/7)) ([29b67b1](https://github.com/TatuArvela/manifesto/commit/29b67b1f12f14b885a67db3d15e74a79cbe04f0a))

## 0.1.0 (2026-08-30)


### Features

* **server:** gate /register on REGISTRATION_ENABLED flag ([b227b63](https://github.com/TatuArvela/manifesto/commit/b227b633d7296db746781f76067298bea4595ebd))
* **server:** per-user rate limit on /api/notes and /api/search ([d9777b9](https://github.com/TatuArvela/manifesto/commit/d9777b9a0b5d3e638e4f5e2bcf72be33066bd4e5))
* **server:** tighten note schema with size + URL constraints ([86e47d3](https://github.com/TatuArvela/manifesto/commit/86e47d3dc0c923cb187cd99711a971a1bdad243e))


### Bug Fixes

* **client:** guard localStorage writes against QuotaExceededError ([2f63d34](https://github.com/TatuArvela/manifesto/commit/2f63d345edb8b1d325c46f968119671f24abe200))
* **client:** NoteCardEditor compares against last-saved content ([ffe962f](https://github.com/TatuArvela/manifesto/commit/ffe962fb1d6081ba9eb1d8683ac29c52b1cd1034))
* **client:** refetch notes on WebSocket reconnect ([842e486](https://github.com/TatuArvela/manifesto/commit/842e48694238b1c1cc2b7c75680e13cc11a72c69))
* **client:** resolve a11y + optional-chain lint warnings ([130dd7c](https://github.com/TatuArvela/manifesto/commit/130dd7ceee4be0c3c23e39d27f0568812f4a3565))
* **client:** RestApiAdapter resilience for deleteAll + importAll ([eebb1b5](https://github.com/TatuArvela/manifesto/commit/eebb1b5c796317599b4f12bda0195e113ecca33f))
* **server:** detect username collisions by error code, not message regex ([e55dfa5](https://github.com/TatuArvela/manifesto/commit/e55dfa5622a88a6dcf992c272ecb643db32d9c2a))

## Changelog

All notable changes to Manifesto are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases below `1.0.0` are pre-stable: minor bumps may include breaking changes.

This file is maintained automatically by [release-please](https://github.com/googleapis/release-please)
based on [Conventional Commits](https://www.conventionalcommits.org/). Do not edit by hand.
