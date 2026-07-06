"""Full-fidelity, evolving dry-run sample at realistic volume.

Dry-run (offline) mode should exercise the dashboard at production shape and scale, not
with toy data. Every node produced here carries the exact 61-field schema of the committed
live-response mock (``os_vulns_response_exemple.json``), and the default volume mirrors a
real tenant register: ``DEMO_VOLUME`` (5k CRITICAL / 60k HIGH — the default fetch scope).
Tests shrink it via the ``WIZ_DEMO_VOLUME`` env var (e.g. ``"CRITICAL=6,HIGH=11"``) so
AppTest runs stay fast; the env is read at call time, so ``monkeypatch.setenv`` works and
import order doesn't matter.

Everything is index-arithmetic over fixed pools — no ``random``, no clocks — so a snapshot
is fully reproducible and MTTR/SLA figures are deterministic. Heavy sub-objects (hosts,
package details, cvss vectors, the projects list) are shared by reference across nodes:
that is the codebase's explicit contract (``transform.merge_nodes`` shares node dicts and
never mutates; ``incremental_flat_sample`` below shallow-copies before touching a node),
and it keeps a 65k-node snapshot in the ~160 MB range instead of several times that.

``evolving_flat_sample(seq)`` steps a *sequence* of snapshots so scan-over-scan badges and
the MTTR trend move offline: ``seq == 0`` is the baseline at ``demo_volume()`` counts;
``seq >= 1`` cycles ``_SCENARIOS`` — fractional multipliers over the baseline, so counts
rise and fall by a visible-but-realistic margin at any volume. Finding ids are stable per
``(severity, index)`` and counts change at the tail, so a rising count adds new vulns and
a falling count lets the surplus disappear (resolved-by-disappearance in the ledger) — a
realistic lifecycle, not just a number swap.
"""

import os
from datetime import date, timedelta
from functools import lru_cache

# --------------------------------------------------------------------------- volume

DEMO_VOLUME = {"CRITICAL": 5_000, "HIGH": 60_000}
_VOLUME_ENV = "WIZ_DEMO_VOLUME"

_SEV_ORDER = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"]


def demo_volume() -> dict:
    """Per-severity node counts for the baseline snapshot.

    ``WIZ_DEMO_VOLUME`` (``"SEV=count,SEV=count"``) overrides ``DEMO_VOLUME`` — the test
    suite pins a tiny volume there. Unparseable entries are skipped; a fully unparseable
    or empty value falls back to the default.
    """
    spec = os.environ.get(_VOLUME_ENV, "").strip()
    if not spec:
        return dict(DEMO_VOLUME)
    counts = {}
    for part in spec.split(","):
        sev, _, num = part.partition("=")
        try:
            counts[sev.strip().upper()] = max(0, int(num))
        except ValueError:
            continue
    return counts or dict(DEMO_VOLUME)


# ---------------------------------------------------------------- deterministic pools

# Fractional multipliers over demo_volume() for each evolution step (the list cycles).
# Chosen so consecutive scans show a clear mix of rises (red) and falls (green); at full
# volume the churn is hundreds-to-thousands of findings, at test volume it's ±1-2.
_SCENARIOS = [
    {"CRITICAL": 1.04, "HIGH": 0.98},
    {"CRITICAL": 0.92, "HIGH": 1.01},
    {"CRITICAL": 1.10, "HIGH": 0.95},
    {"CRITICAL": 1.00, "HIGH": 1.03},
]

_HOST_COUNT = 800
# "legacy" keeps a ^legacy- name in the fleet: the Domains name_regex rule demo/tests
# classify those hosts, and every real fleet has them.
_ROLES = ["web", "api", "db", "batch", "cache", "worker", "k8s-node", "legacy"]
_CLOUDS = ["AWS", "Azure", "GCP"]
_NATIVE_TYPE = {"AWS": "ec2", "Azure": "virtualMachine", "GCP": "instance"}
# subscriptionName + tags feed the rule-based domain triage (Settings → Domains), so the
# demo persists real rule inputs into the ledger and the domain surfaces work offline.
_SUBSCRIPTIONS = [
    ("core-prod", "111122223333", "2b2211fb-742f-5566-af67-ab8992b58cfb"),
    ("prod-account", "444455556666", "1fafc3d1-bbe3-5d13-8698-3df1f4514e37"),
    ("prod-registry", "777788889999", "86a11580-2086-56a7-88d2-27f405958fcb"),
    ("data-prod", "azure-sub-001", "5c1d2e3f-4a5b-6c7d-8e9f-0a1b2c3d4e5f"),
    ("ml-prod", "gcp-ml-prod", "9e8d7c6b-5a4f-3e2d-1c0b-a9b8c7d6e5f4"),
    ("dev-account", "222233334444", "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc"),
]
_TEAMS = ["web", "platform", "data", "sre", "payments", "ml"]
_OS_DISTROS = [
    ("Ubuntu", {"id": "os-ubuntu-2404", "name": "Ubuntu 24.04", "icon": "ubuntu"}),
    ("Ubuntu", {"id": "os-ubuntu-2204", "name": "Ubuntu 22.04", "icon": "ubuntu"}),
    ("Amazon Linux", {"id": "os-al2023", "name": "Amazon Linux 2023", "icon": "amazon-linux"}),
    ("Debian", {"id": "os-debian-12", "name": "Debian 12", "icon": "debian"}),
    ("Red Hat Enterprise Linux", {"id": "os-rhel-9", "name": "RHEL 9", "icon": "redhat"}),
]
_INSTANCE_GROUPS = [
    {"id": "asg-web-prod", "externalId": "asg-web-prod-01", "name": "web-prod-asg",
     "replicaCount": 4, "tags": {"env": "prod"}},
    {"id": "gke-core-n4-shared", "externalId": "gke-core-n4-shared-19b3",
     "name": "n4-shared-19b3", "replicaCount": 12,
     "tags": {"goog-k8s-cluster-name": "core-gke-eu"}},
    {"id": "vmss-api-prod", "externalId": "vmss-api-prod-02", "name": "api-prod-vmss",
     "replicaCount": 6, "tags": {"env": "prod"}},
]

# (package, version, fixedVersion, locationPath, manager, categories, description).
# Deliberately excludes openssl/python/vim: the live query filters those out via
# filterBy.detailedNameV2.notEquals, so a faithful sample can't contain them either.
_PACKAGES = [
    ("sudo", "1.9.13p3-1ubuntu3.4", "1.9.15p2-3ubuntu2", "/usr/bin/sudo", "DPKG",
     ["PRIVILEGE_ESCALATION"],
     "A flaw in sudo's chroot handling allows a local user with limited sudo privileges "
     "to escalate to root via a crafted nsswitch configuration."),
    ("glibc", "2.35-0ubuntu3.8", "2.35-0ubuntu3.9", "/lib/x86_64-linux-gnu/libc.so.6",
     "DPKG", ["REMOTE_CODE_EXECUTION"],
     "A buffer overflow in the DNS stub resolver can be triggered by a malicious DNS "
     "response, potentially leading to remote code execution."),
    ("linux-image-generic", "6.8.0-1015.16", "6.8.0-1016.17",
     "/boot/vmlinuz-6.8.0-1015-generic", "DPKG",
     ["PRIVILEGE_ESCALATION", "DENIAL_OF_SERVICE"],
     "A use-after-free in the kernel's netfilter subsystem allows a local unprivileged "
     "user to crash the system or escalate privileges."),
    ("curl", "8.5.0-2ubuntu10.6", "8.5.0-2ubuntu10.8", "/usr/bin/curl", "DPKG",
     ["INFORMATION_DISCLOSURE"],
     "A heap read overflow when parsing chunked transfer encoding can leak adjacent "
     "memory contents to a malicious server."),
    ("bash", "5.2.21-2ubuntu4", "5.2.21-2ubuntu4.1", "/usr/bin/bash", "DPKG",
     ["REMOTE_CODE_EXECUTION"],
     "Improper sanitization of environment variables allows command injection when "
     "scripts process attacker-controlled input."),
    ("systemd", "255.4-1ubuntu8.4", "255.4-1ubuntu8.6", "/usr/lib/systemd/systemd",
     "DPKG", ["DENIAL_OF_SERVICE"],
     "A malformed DHCP lease can crash systemd-networkd, disrupting network "
     "configuration on affected hosts."),
    ("openssh-server", "9.6p1-3ubuntu13.5", "9.6p1-3ubuntu13.8", "/usr/sbin/sshd",
     "DPKG", ["REMOTE_CODE_EXECUTION"],
     "A signal-handler race condition in sshd may allow unauthenticated remote code "
     "execution as root under specific timing conditions."),
    ("libxml2", "2.9.14+dfsg-1.3ubuntu3", "2.9.14+dfsg-1.3ubuntu3.1",
     "/usr/lib/x86_64-linux-gnu/libxml2.so.2", "DPKG", ["DENIAL_OF_SERVICE"],
     "An XML entity expansion flaw allows crafted documents to exhaust memory during "
     "parsing."),
    ("zlib1g", "1.3.dfsg-3.1ubuntu2", "1.3.dfsg-3.1ubuntu2.1",
     "/usr/lib/x86_64-linux-gnu/libz.so.1", "DPKG", ["DENIAL_OF_SERVICE"],
     "A heap corruption in inflate() can be triggered by a crafted compressed stream."),
    ("libpam-modules", "1.5.3-5ubuntu5.1", "1.5.3-5ubuntu5.4",
     "/usr/lib/x86_64-linux-gnu/security/pam_unix.so", "DPKG",
     ["PRIVILEGE_ESCALATION"],
     "A logic error in pam_unix allows authentication bypass when specific fallback "
     "modules are configured."),
    ("dbus", "1.14.10-4ubuntu4.1", "1.14.10-4ubuntu4.2", "/usr/bin/dbus-daemon",
     "DPKG", ["DENIAL_OF_SERVICE"],
     "An unauthenticated message with a malformed header can crash the system bus."),
    ("containerd.io", "1.7.19-1", "1.7.22-1", "/usr/bin/containerd", "DPKG",
     ["PRIVILEGE_ESCALATION"],
     "A container escape is possible when a crafted image manifest bypasses mount "
     "namespace isolation."),
    ("nginx", "1.24.0-2ubuntu7.1", "1.24.0-2ubuntu7.3", "/usr/sbin/nginx", "DPKG",
     ["INFORMATION_DISCLOSURE"],
     "A request smuggling flaw in HTTP/2 downgrade handling can expose backend "
     "responses to other clients."),
    ("git", "2.43.0-1ubuntu7.1", "2.43.0-1ubuntu7.2", "/usr/bin/git", "DPKG",
     ["REMOTE_CODE_EXECUTION"],
     "Cloning a malicious repository can execute arbitrary code via crafted hook "
     "templates in submodules."),
    ("krb5-libs", "1.21.2-3.el9", "1.21.2-4.el9",
     "/usr/lib64/libkrb5.so.3", "RPM", ["INFORMATION_DISCLOSURE"],
     "A ticket-parsing flaw in the KDC client library can disclose process memory to "
     "a rogue realm."),
    ("gnutls", "3.8.3-4.el9", "3.8.3-6.el9", "/usr/lib64/libgnutls.so.30", "RPM",
     ["INFORMATION_DISCLOSURE"],
     "A timing side channel in RSA-PSK key exchange allows recovery of session "
     "secrets by a network attacker."),
]

_PROJECTS = [{"id": "1dfea0cf-834f-5522-b797-bee5aaf09251", "name": "Production",
              "slug": "production", "isFolder": False}]

_CVSS_V3_POOL = [
    {"attackVector": "LOCAL", "attackComplexity": "LOW", "confidentialityImpact": "HIGH",
     "integrityImpact": "HIGH", "privilegesRequired": "LOW",
     "userInteractionRequired": False,
     "vectorString": "CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED"},
    {"attackVector": "NETWORK", "attackComplexity": "LOW", "confidentialityImpact": "HIGH",
     "integrityImpact": "HIGH", "privilegesRequired": "NONE",
     "userInteractionRequired": False,
     "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H", "scope": "UNCHANGED"},
    {"attackVector": "NETWORK", "attackComplexity": "HIGH", "confidentialityImpact": "NONE",
     "integrityImpact": "NONE", "privilegesRequired": "NONE",
     "userInteractionRequired": False,
     "vectorString": "CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H", "scope": "UNCHANGED"},
    {"attackVector": "NETWORK", "attackComplexity": "LOW", "confidentialityImpact": "HIGH",
     "integrityImpact": "NONE", "privilegesRequired": "NONE",
     "userInteractionRequired": True,
     "vectorString": "CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:N/A:N", "scope": "UNCHANGED"},
]

# Distinct CVE names per severity: the same CVE recurring across many hosts is the
# realistic fleet pattern (one advisory, hundreds of affected machines).
_CVE_POOL_SIZE = {"CRITICAL": 120, "HIGH": 600}
_CVE_BLOCK = {"CRITICAL": 20000, "HIGH": 40000, "MEDIUM": 60000, "LOW": 70000,
              "INFO": 80000}
# (score base, distinct steps of 0.1) per severity — keeps scores in-band.
_SCORE = {"CRITICAL": (9.0, 10), "HIGH": (7.0, 20), "MEDIUM": (4.0, 30),
          "LOW": (1.0, 29), "INFO": (0.0, 10)}
# (min days-to-resolve, modulo span): straddles the SLA targets (7d/14d/…) so the SLA
# posture shows both met and breached remediation, deterministically.
_RESOLVE_DAYS = {"CRITICAL": (2, 19), "HIGH": (3, 30), "MEDIUM": (5, 55),
                 "LOW": (10, 60), "INFO": (10, 60)}
_SEV_ONE_LOWER = {"CRITICAL": "HIGH", "HIGH": "MEDIUM", "MEDIUM": "LOW", "LOW": "INFO",
                  "INFO": "INFO"}

_FIRST_SPAN_DAYS = 175  # firstDetectedAt spread: 2026-01-05 .. 2026-06-28
_BASE_DATE = date(2026, 1, 5)
_OPEN_LAST_DETECTED = "2026-07-01T06:00:00Z"  # shared "most recent scan" stamp
_KEV_RELEASE = "2026-04-03T00:00:00Z"
_KEV_DUE = "2026-04-24T00:00:00Z"
_FIX_BEFORE = "2026-08-02T00:00:00Z"
_EMPTY_LIST = []  # shared, never mutated (same contract as shared node dicts)


@lru_cache(maxsize=1)
def _date_pool():
    """ISO date strings from the fixed base — index arithmetic, no wall clock."""
    return [(_BASE_DATE + timedelta(days=d)).isoformat()
            for d in range(_FIRST_SPAN_DAYS + max(lo + span for lo, span in
                                                  _RESOLVE_DAYS.values()) + 1)]


@lru_cache(maxsize=1)
def _hosts():
    """The demo fleet: ``_HOST_COUNT`` vulnerableAsset dicts, shared across findings."""
    hosts = []
    for j in range(_HOST_COUNT):
        role = _ROLES[j % len(_ROLES)]
        cloud = _CLOUDS[j % len(_CLOUDS)]
        sub_name, sub_ext, sub_id = _SUBSCRIPTIONS[j % len(_SUBSCRIPTIONS)]
        os_name, distro = _OS_DISTROS[j % len(_OS_DISTROS)]
        env = "dev" if j % 10 == 9 else "prod"
        tags = {"env": env, "team": _TEAMS[(j // 3) % len(_TEAMS)]}
        if role == "db":
            tags["tier"] = "data"
        image = f"ami-{j * 2654435761 % 0xFFFFFFFFFFFF:012x}" if cloud == "AWS" else None
        hosts.append({
            "id": f"asset-{j:04d}-{j * 40503 % 0xFFFF:04x}",
            "type": "VIRTUAL_MACHINE",
            "name": f"{role}-{env}-{j:03d}",
            "cloudPlatform": cloud,
            "subscriptionName": sub_name,
            "subscriptionExternalId": sub_ext,
            "subscriptionId": sub_id,
            "tags": tags,
            "operatingSystem": os_name,
            "operatingSystemDistribution": distro,
            "imageName": image,
            "imageId": image,
            "imageNativeType": "AMI" if cloud == "AWS" else None,
            "hasLimitedInternetExposure": j % 7 == 0,
            "hasWideInternetExposure": j % 11 == 0,
            "isAccessibleFromVPN": j % 5 == 0,
            "isAccessibleFromOtherVnets": False,
            "isAccessibleFromOtherSubscriptions": False,
            "computeInstanceGroup": _INSTANCE_GROUPS[j % len(_INSTANCE_GROUPS)]
            if j % 3 == 0 else None,
            "nativeType": _NATIVE_TYPE[cloud],
            "isUsedOnPrem": False,
            "resourceGroupExternalId": f"rg-{sub_name}" if cloud == "Azure" else None,
        })
    return hosts


@lru_cache(maxsize=1)
def _package_details():
    """Pre-built per-package sub-objects, shared by reference across findings."""
    out = []
    for name, ver, fixed, loc, mgr, cats, desc in _PACKAGES:
        out.append({
            "name": name,
            "detailedName": f"{name} {ver}",
            "version": ver,
            "fixedVersion": fixed,
            "locationPath": loc,
            "description": desc,
            "categories": cats,
            "artifactType": {"group": "OS_PACKAGE", "codeLibraryLanguage": None,
                             "osPackageManager": mgr, "hostedTechnology": None,
                             "plugin": False, "custom": False, "ciComponent": False},
            "versionResolutionPrimarySource": {"type": "OS_PACKAGE_MANAGER",
                                               "version": ver},
            "rootComponent": {"name": name},
        })
    return out


def _full_finding(severity, i):
    """One deterministic finding with the full 61-field live schema.

    Stable id per ``(severity, index)`` so counts rising/falling at the tail model a
    realistic add/disappear lifecycle across scans. Every varying value is derived from
    ``i`` by modular arithmetic over the pools above.
    """
    dates = _date_pool()
    host = _hosts()[i % _HOST_COUNT]
    cve_pool = _CVE_POOL_SIZE.get(severity, 60)
    k = (i // _HOST_COUNT + i % _HOST_COUNT) % cve_pool  # unique CVE per host
    pkg = _package_details()[k % len(_package_details())]

    first_off = (i * 37) % _FIRST_SPAN_DAYS
    first = f"{dates[first_off]}T{(i * 7) % 24:02d}:{(i * 13) % 60:02d}:00Z"
    published = f"{dates[max(0, first_off - 10)]}T00:00:00Z"

    resolved = i % 12 == 5  # ≈8.3% resolved → MTTR/SLA stay populated
    if resolved:
        lo, span = _RESOLVE_DAYS.get(severity, (5, 55))
        res_off = min(first_off + lo + i % span, len(dates) - 1)
        resolved_at = f"{dates[res_off]}T12:00:00Z"
        last_detected = f"{dates[res_off]}T06:00:00Z"
    else:
        resolved_at = None
        last_detected = _OPEN_LAST_DETECTED

    base, steps = _SCORE.get(severity, (4.0, 30))
    score = round(base + (i % steps) * 0.1, 1)
    epss_prob = round((i * 17) % 1000 / 1000, 3)
    kev = i % 17 == 0
    has_exploit = kev or i % 5 == 0
    transitive = i % 13 == 0

    return {
        "id": f"demo-{severity.lower()}-{i}",
        "name": f"CVE-{2024 + k % 3}-{_CVE_BLOCK.get(severity, 90000) + k}",
        "detailedName": pkg["detailedName"],
        "description": pkg["description"],
        "severity": severity,
        "status": "RESOLVED" if resolved else "OPEN",
        "fixedVersion": pkg["fixedVersion"],
        "detectionMethod": "OS_PACKAGE",
        "firstDetectedAt": first,
        "firstDetectedAtSource": "SCHEDULED_SCAN",
        "lastDetectedAt": last_detected,
        "resolvedAt": resolved_at,
        "validatedInRuntime": i % 6 == 0,
        "runtimeValidationResult": "CONFIRMED" if i % 6 == 0 else None,
        "reachability": (None, "NETWORK", "INTERNAL")[i % 3],
        "hasTriggerableRemediation": i % 9 == 0,
        "remediationPullRequestAvailable": i % 18 == 0,
        "dataSourceName": "Wiz Sensor",
        "fixDate": resolved_at,
        "fixDateBefore": _FIX_BEFORE if not resolved and i % 10 == 3 else None,
        "publishedDate": published,
        "version": pkg["version"],
        "versionResolutionPrimarySource": pkg["versionResolutionPrimarySource"],
        "isOperatingSystemEndOfLife": False,
        "recommendedVersion": pkg["fixedVersion"],
        "locationPath": pkg["locationPath"],
        "artifactType": pkg["artifactType"],
        "projects": _PROJECTS,
        "ignoreRules": _EMPTY_LIST,
        "note": None,
        "layerMetadata": None,
        "vulnerableAsset": host,
        "sourceMappedCodeFindings": _EMPTY_LIST,
        "transitivity": "DIRECT" if transitive else None,
        "rootComponent": pkg["rootComponent"] if transitive else None,
        "isHighProfileThreat": i % 25 == 0,
        "vendorSeverity": severity,
        "nvdSeverity": _SEV_ONE_LOWER[severity] if i % 4 == 0 else severity,
        "weightedSeverity": severity,
        "hasExploit": has_exploit,
        "usedInCodeResult": None,
        "hasCisaKevExploit": kev,
        "cisaKevReleaseDate": _KEV_RELEASE if kev else None,
        "cisaKevDueDate": _KEV_DUE if kev else None,
        "score": score,
        "epssSeverity": ("CRITICAL" if epss_prob >= 0.7 else
                         "HIGH" if epss_prob >= 0.4 else
                         "MEDIUM" if epss_prob >= 0.1 else "LOW"),
        "epssPercentile": round((i * 29) % 1000 / 1000, 3),
        "epssProbability": epss_prob,
        "categories": pkg["categories"],
        "hasInitialAccessPotential": i % 21 == 0,
        "isClientSide": False,
        "affectedBySettings": i % 33 == 0,
        "codeLibraryLanguage": None,
        "exploitabilityValidationStatus": ("EXPLOITABLE" if has_exploit else
                                           "NOT_EXPLOITABLE" if i % 3 else "UNKNOWN"),
        "cvssv2": None,
        "cvssv3": _CVSS_V3_POOL[i % len(_CVSS_V3_POOL)],
        "effectiveAvailabilityImpact": "HIGH" if severity in ("CRITICAL", "HIGH")
        else "LOW",
        "cnaScore": round(max(0.0, score - 0.7), 1),
        "vendorScore": score,
        "origin": "CONTEXTUAL",
        "duplicateOf": None,
    }


# ------------------------------------------------------------- snapshots + evolution

def _counts_for_seq(seq: int) -> dict:
    """Per-severity counts for scan ``seq``: the baseline volume scaled by the scenario.

    When rounding would swallow a small scenario delta (tiny test volumes), nudge by ±1
    so adjacent scans always differ and the change badges stay demoable.
    """
    base = demo_volume()
    if seq <= 0:
        return base
    mults = _SCENARIOS[(seq - 1) % len(_SCENARIOS)]
    counts = {}
    for sev, n in base.items():
        mult = mults.get(sev, 1.0)
        target = round(n * mult)
        if mult != 1.0 and target == n:
            target = n + (1 if mult > 1.0 else -1)
        counts[sev] = max(0, target)
    return counts


@lru_cache(maxsize=2)
def _snapshot(counts_key: tuple):
    """Build (and memoize) the envelope for a counts spec.

    Keyed on the counts themselves — an env-var change is a natural cache miss.
    ``maxsize=2`` holds the two consecutive snapshots ``incremental_flat_sample`` diffs
    without letting ~160 MB full-volume variants accumulate.
    """
    nodes = [_full_finding(severity, i) for severity, n in counts_key for i in range(n)]
    return {"data": {"vulnerabilityFindings": {
        "nodes": nodes,
        "pageInfo": {"hasNextPage": False, "endCursor": None},
    }}}


def _counts_key(counts: dict) -> tuple:
    known = [(s, counts[s]) for s in _SEV_ORDER if counts.get(s)]
    extra = [(s, n) for s, n in sorted(counts.items()) if s not in _SEV_ORDER and n]
    return tuple(known + extra)


def evolving_flat_sample(seq: int = 0):
    """Raw flat dry-run response for scan ``seq`` (0 = the full-volume baseline)."""
    return _snapshot(_counts_key(_counts_for_seq(seq)))


def incremental_flat_sample(seq: int):
    """Raw flat DELTA between demo scans ``seq - 1`` and ``seq`` — the offline stand-in
    for a live ``updatedAt``-filtered incremental fetch.

    Ids present only in scan ``seq`` are emitted as their new OPEN findings; ids present
    only in scan ``seq - 1`` are emitted as ``status=RESOLVED`` nodes with a deterministic
    ``resolvedAt``. That mirrors how the live API reports change: a resolution arrives as
    a re-listed RESOLVED node (API-declared), never as an absence — an incremental fetch
    genuinely cannot observe disappearances. Returns the canonical envelope with an empty
    ``nodes`` list when nothing changed. ``seq <= 0`` is the baseline scan itself, which
    has no predecessor to diff against → empty delta.
    """
    empty = {"data": {"vulnerabilityFindings": {
        "nodes": [], "pageInfo": {"hasNextPage": False, "endCursor": None}}}}
    if seq <= 0:
        return empty
    prev_nodes = evolving_flat_sample(seq - 1)["data"]["vulnerabilityFindings"]["nodes"]
    curr_nodes = evolving_flat_sample(seq)["data"]["vulnerabilityFindings"]["nodes"]
    prev_by_id = {n["id"]: n for n in prev_nodes}
    curr_ids = {n["id"] for n in curr_nodes}

    delta = [n for n in curr_nodes if n["id"] not in prev_by_id]  # new findings
    # Deterministic per-seq resolution stamp (no clocks — the demo stays reproducible).
    resolved_at = f"2026-05-{min(seq, 28):02d}T12:00:00Z"
    for node in prev_nodes:
        if node["id"] in curr_ids:
            continue
        gone = dict(node)  # never mutate the scenario/baseline node
        gone["status"] = "RESOLVED"
        gone["resolvedAt"] = resolved_at
        delta.append(gone)
    if not delta:
        return empty
    return {"data": {"vulnerabilityFindings": {
        "nodes": delta, "pageInfo": {"hasNextPage": False, "endCursor": None}}}}
