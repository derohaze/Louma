# Mining device authorization boundary

**Current browser policy (ADR-018):** mining runs with canonical browser key proofs,
exact-key leases, account quotas and risk-based password/2FA verification before
start. Shared hardware or IP addresses do not establish a conflict. Financial
settlement checks the persisted admission receipt and lease independently.
See [current browser report](browser-mining-report.md) for the test matrix,
measurements, migration steps and remaining browser/Sybil boundary.

## Superseded strict phase and hardware investigation

The following text records the earlier strict phase. Its default-off policy and
hardware enrollment proposal are superseded by the user's browser-only decision.
Strict remains an explicit maintenance option, not the default browser behavior.

This release defaults to strict mode and authorizes **no new mining devices**.
Enrollment, start and proof operations return `mining_verified_device_required`.
No native client, trusted hardware enrollment or paid provider is installed.
The user-visible requirements endpoint reports enrollment unavailable; the web
UI disables Start and explains the restriction in English and Arabic. Existing
cycles can stop/settle, and the account/wallet stay available.

## Evidence and authority

| Evidence | What it establishes | Production mining authority |
| --- | --- | --- |
| Valid browser P-256 proof | Possession of that key for a nonce | None; one computer can create many keys |
| Machine hash or correlated fingerprint | A match under a client-controlled heuristic | None; no verified identity merge |
| Shared IP, VPN change, network residency | Supporting network history | None; no one-IP-one-device rule |
| CNG/TPM signing, non-exportable key, TPM-present flag | At most key/platform claims under the available verifier | None; many keys may belong to one TPM |
| Independently validated hardware enrollment | Requires the primitive described below | Not implemented/supported |

Strict guards run at start, resolution/enrollment and challenge/proof service
entry points, before admission state changes. Direct HTTP calls and disabling
heuristic flags cannot bypass them. An unknown/missing identity mode also refuses.
`legacy-test` is configuration-restricted to isolated loopback test databases.
The four permanent `OPEN` witnesses remain actual failures of that diagnostic
legacy policy, not repaired physical-identity successes.

## Missing trusted primitive

Read-only inspection of the available Windows host found a present/ready/enabled
TPM, with no manufacturer endorsement certificate reported and one additional
certificate. That additional certificate was not accepted as trusted. No hardware
identifier was printed. The repository has no pinned manufacturer roots, trusted
EK inventory, verifier or native mining client; no .NET SDK was reported.

Microsoft distinguishes credential-based, EK-certificate and administrator-managed
EK-public-key trust in its [TPM key attestation documentation](https://learn.microsoft.com/en-us/windows-server/identity/ad-ds/manage/component-updates/tpm-key-attestation).
Its [trusted TPM roots guidance](https://learn.microsoft.com/en-us/windows-server/security/guarded-fabric-shielded-vm/guarded-fabric-install-trusted-tpm-root-certificates)
requires an explicit certificate trust policy. TPM signing alone is insufficient.

A future supported configuration must independently bind an attested signing key
to an approved, stable endorsement identity and establish the scope in which that
identity represents one authorized physical device. A TPM identity is not
automatically a chassis identity: removable TPMs, multiple TPMs, relays and platform
compromise need explicit exclusions or stronger inventory controls. Multiple keys
from one admitted endorsement identity must converge on one server-owned enrollment.
This release cannot establish that binding, so it refuses rather than accepting
caller-supplied certificates, self-signed keys or asserted device IDs.

## Enrollment lifecycle gate for a future implementation

Before changing strict mode, independently test certificate chain/revocation and
fresh attestation challenge validation, enrollment uniqueness under MongoDB
transactions and unique constraints, authenticated short-lived request proofs,
nonce replay/expiry, key rotation tied to the same enrollment, revocation and
lost-device recovery without simultaneous re-enrollment. Raw EK identities should
not enter public APIs or logs; any necessary server-side pseudonym remains private.
No proposed lifecycle protocol in this document is currently an available API.

Rotation, reinstall, reset and recovery currently confer no mining authorization.
Existing browser nonces never become hardware trust. An unverifiable recovery
cannot silently create a new trusted enrollment or bypass another account's lease.

## Reproducible device matrix and its limits

| Scenario | Synthetic backend evidence | Real hardware validation / strict behavior |
| --- | --- | --- |
| Same-model laptops or similar CPU/GPU | OPEN coarse-hash collision witness | No two-laptop study; both unsupported |
| One computer, different browsers or fresh keys | OPEN alternate-evidence and valid-proof witnesses | No physical uniqueness claim; strict refuses |
| Browser update / rendering drift | Legacy drift/history and continuity tests | No real update matrix; strict refuses |
| Reinstall / storage reset / lost key | Fresh-key strict attempts and unverified recovery refusal | No successful attested recovery supported |
| Multiple accounts, one machine | Synthetic concurrent accounts, two API instances | Strict refuses all unverified starts without merging |
| Different devices sharing NAT | Legacy established fixtures and strict shared-NAT attempts | No verified physical pair tested; strict refuses both |
| VPN / other network / ordering | Different-network witnesses; both resident/newcomer orders | Network never grants strict trust |
| VM, vTPM, absent/unendorsed TPM | Caller-supplied attestation/flags fail strict guard | Unsupported; no native VM detector claimed |
| Ready local Windows TPM | Read-only host capability inventory only | No independently trusted enrollment established |

Thus zero hardware configurations are supported for new mining. This prevents
unverified identity spoofing from opening production cycles by denying admission;
it does not demonstrate successful one-device-one-enrollment or availability for
legitimate miners. No guarantee covers arbitrary hardware compromise, relay,
platform compromise or real-world fingerprint false-positive rates.
