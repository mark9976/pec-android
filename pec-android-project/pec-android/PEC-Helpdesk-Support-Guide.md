# Power Equipment Checkout — Helpdesk Support Guide

**Application URL:** https://biapps01.abarta.com:8443/pec/  
**Handheld URL:** https://biapps01.abarta.com:8443/pec/handheld/  
**Service Name:** CRAW (Windows Service)  
**Server:** biapps01.abarta.com  
**Database:** Snowflake — DB_BI_P_EDW.ABARTA_GENERAL (with local SQLite cache)  
**Module Owner:** Mark Kaufmann  

---

## Table of Contents

1. [Application Overview](#1-application-overview)
2. [User Roles & Permissions](#2-user-roles--permissions)
3. [Common User Workflows](#3-common-user-workflows)
4. [Troubleshooting by Symptom — Handheld](#4-troubleshooting-by-symptom--handheld)
5. [Troubleshooting by Symptom — Admin Dashboard](#5-troubleshooting-by-symptom--admin-dashboard)
6. [Troubleshooting by Symptom — Infrastructure](#6-troubleshooting-by-symptom--infrastructure)
7. [Error Message Reference](#7-error-message-reference)
8. [Server-Side Diagnostics](#8-server-side-diagnostics)
9. [Escalation Guide](#9-escalation-guide)
10. [Android Native App](#10-android-native-app)
11. [Troubleshooting by Symptom — Android Native App](#11-troubleshooting-by-symptom--android-native-app)
12. [Error Message Reference — Android Native App](#12-error-message-reference--android-native-app)
13. [Android App Deployment & Updates](#13-android-app-deployment--updates)

---

## 1. Application Overview

Power Equipment Checkout (PEC) is a web application that digitizes the pre-operation safety inspection process for powered industrial equipment (forklifts, reach trucks, walkies, etc.) at Abarta Coca-Cola distribution centers. It replaces paper-based daily inspection checklists with a mobile-friendly PWA that operators use before each shift.

### Architecture

| Component | Location | Purpose |
|-----------|----------|---------|
| Admin Dashboard | https://biapps01.abarta.com:8443/pec/ | Desktop UI for managing equipment, operators, checklists, and reviewing history |
| Handheld App (PWA) | https://biapps01.abarta.com:8443/pec/handheld/ | Mobile app operators use on warehouse handhelds for pre-op inspections |
| Android Native App | Installed on warehouse handheld devices (`com.abarta.pec`) | Capacitor-wrapped shell that provides native NFC, camera, and server configuration; redirects to the server-hosted PWA |
| Badge Registration | https://biapps01.abarta.com:8443/pec/handheld/register.html | Page for registering new NFC badges to operators |
| CRAW Service | `C:\craw\service\CRAW.Server.exe` | Windows Service hosting the module |
| Module Files | `C:\craw\modules\powerequipcheckout\` | Module DLL, config, and SQLite cache |
| Snowflake | DB_BI_P_EDW.ABARTA_GENERAL.PEC_* tables | Permanent data store |
| SQLite Cache | `C:\craw\modules\powerequipcheckout\pec-cache.db` | Local cache for fast reads and offline resilience |

### How It Works

**App launch:** The native Android app (`com.abarta.pec`) loads a local settings shell. On first run, the user configures the server URL and device token. After configuration, the app redirects its WebView to the server-hosted handheld PWA at `{serverUrl}/handheld/?token={deviceToken}`. From that point, the checkout workflow runs inside the remote PWA, but native NFC and camera remain available through the Capacitor bridge.

1. **Operator arrives at shift** → opens the handheld PWA on a warehouse device
2. **Scans badge** (NFC tap or manual entry) → enters PIN to authenticate
3. **Scans equipment barcode** → system loads the appropriate checklist
4. **Completes pre-op inspection** → passes or fails each checklist item with enforced delay timers
5. **If an item fails** → takes a photo of the defect, enters corrective action notes
6. **Signs the inspection** → draws signature on touchscreen to attest
7. **System records the session** → syncs to server, locks unsafe equipment automatically
8. **Supervisor reviews** → can perform spot checks, unlock equipment, review history

### Admin Dashboard Tabs

| Tab | Purpose | Minimum Role |
|-----|---------|-------------|
| **Equipment** | Manage forklift/truck inventory — add, edit, view barcodes | User |
| **Operators** | Manage operator accounts, assign badges, set PINs | User |
| **Checkout History** | View all completed inspection sessions with pass/fail status | User |
| **Locked Equipment** | View currently locked-out equipment and unlock with resolution notes | User |
| **Checklist Items** | Configure inspection checklist questions and failure instructions | User |
| **Supervisor Checks** | View supervisor spot-check audit records | User |
| **Sites** | Manage distribution center / site locations | User |
| **Lockout Reasons** | Configure lockout reason categories | User |

### Handheld Menus (by Role)

| Role | Menu Options |
|------|-------------|
| **Operator** | Pre-Op Checkout, Lock Equipment |
| **Supervisor** | Pre-Op Checkout, Supervisor Check, Lock Equipment, Manage Users |
| **Admin** | Pre-Op Checkout, Supervisor Check, Lock Equipment, Manage Users, Manage Sites, Create Supervisors |

---

## 2. User Roles & Permissions

PEC has **two layers** of roles:

### Platform Roles (AD-based — controls access to the Admin Dashboard)

| Role | AD Group | Dashboard Access |
|------|----------|-----------------|
| **Admin** | `ABARTA\ACCB_DEPTS_IT-M` | Full access to all admin dashboard tabs |
| **User** | `ABARTA\ACCB_PEC_USERS` | Full access to all admin dashboard tabs |
| **Viewer** | *(default — no group required)* | Read-only access to dashboard (cannot edit) |

### Operator Roles (Badge-based — controls handheld app features)

| Role | Assignment | Handheld Access |
|------|-----------|----------------|
| **OPERATOR** | Set per-operator in admin dashboard | Pre-op checkout and lock equipment |
| **SUPERVISOR** | Set per-operator in admin dashboard | All operator features + supervisor checks + manage users |
| **ADMIN** | Set per-operator in admin dashboard | All supervisor features + manage sites + create supervisors |

> **Key distinction:** Platform roles (AD groups) control who can access the admin web dashboard. Operator roles (stored in the database) control what an operator can do on the handheld device after badge + PIN login.

### Handheld Authentication

- **Badge:** NFC tap or manual UID entry — identifies the operator
- **PIN:** 4–8 digit numeric code — verified cryptographically (PBKDF2 SHA-256, 100,000 iterations)
- **Lockout:** After 5 failed PIN attempts, the account locks for 60 seconds
- **Offline capable:** Badge and PIN data cached locally in IndexedDB for offline login

---

## 3. Common User Workflows

### 3.1 Pre-Op Equipment Checkout (Operator)

1. Open the handheld app on the warehouse device
2. Tap NFC badge or enter badge UID manually
3. Enter 4–8 digit PIN
4. Tap **Pre-Op Checkout**
5. Scan the equipment barcode (NFC or camera)
6. Complete each checklist item:
   - **Pass** — item is in good condition
   - **Fail** — take a photo of the defect, add notes
   - **N/A** — item doesn't apply to this equipment type
   - Each item has a mandatory delay timer (default 10 seconds) before advancing
7. Draw signature on the touchscreen
8. Session is saved and synced to the server
9. If any critical items failed, the equipment is **automatically locked out**

### 3.2 Locking Equipment (Operator/Supervisor)

1. From the handheld menu, tap **Lock Equipment**
2. Scan the equipment barcode
3. Select the lockout reason from the dropdown
4. Add notes describing the issue
5. Equipment is locked — cannot be checked out until cleared

### 3.3 Unlocking Equipment (Admin Dashboard)

1. Open the admin dashboard → **Locked Equipment** tab
2. Find the locked equipment in the list
3. Click **Unlock**
4. Confirm the action and enter resolution notes
5. Equipment is cleared for checkout

### 3.4 Supervisor Spot Check

1. From the handheld menu (Supervisor role), tap **Supervisor Check**
2. Scan the equipment barcode
3. System retrieves the most recent inspection for that equipment
4. Review checklist results, compare to actual equipment condition
5. Record spot-check outcome — results are logged to the audit trail

### 3.5 Adding a New Operator

**From Admin Dashboard:**
1. Go to **Operators** tab → click **+ Add Operator**
2. Enter name, badge UID, PIN (4–8 digits), select role (Operator/Supervisor/Admin)
3. Assign to a site
4. Click **Save**

**From Handheld (Supervisor/Admin):**
1. Tap **Manage Users** → **Add User**
2. Scan or enter the operator's NFC badge
3. Enter name, set PIN, select role
4. Save — operator can immediately log in on any device after sync

### 3.6 Registering a New Badge

1. Navigate to https://biapps01.abarta.com:8443/pec/handheld/register.html
2. A **supervisor** must authenticate first (scan their badge + PIN)
3. Scan the new badge to register
4. The badge is submitted to the server and appears in the admin **Operators** tab under pending badges

### 3.7 Adding Equipment

1. Go to admin dashboard → **Equipment** tab → click **+ Add Equipment**
2. Enter equipment details: name/description, barcode, type, site
3. Click **Save**
4. Print the barcode label (admin dashboard has barcode generation built in)

### 3.8 Syncing Handheld Data

The handheld app works **offline** using IndexedDB. Data syncs automatically when connectivity is available:

- **Outbound sync:** Completed inspection sessions are queued locally and posted to `/pec/api/sync` when the device is online
- **Inbound sync:** Reference data (operators, equipment, checklists, sites) is pulled from the server on login and periodically refreshed
- **Sync status** is shown on the handheld home screen
- **Queue check interval:** Every 60 seconds
- **Error retry delay:** 30 seconds
- **Auth:** Uses `X-Device-Token` header for API authentication

### 3.9 Setting Up a New Android Device

1. Install the PEC APK on the device (sideload or MDM push)
2. Launch the app — the **Server Settings** screen appears
3. Enter **Server URL:** `https://biapps01.abarta.com:8443/pec`
4. Enter **Device Token** (obtain from server config or Mark Kaufmann)
5. Tap **Test Connection** to verify the server is reachable
6. Tap **Save & Connect** — the app saves settings and redirects to the handheld PWA
7. Enable NFC: **Settings → Connected devices → NFC → ON**
8. Grant camera permission when prompted (for defect photos)

---

## 4. Troubleshooting by Symptom — Handheld

### 4.1 "Badge not recognized"

**What the user sees:** After scanning or entering a badge UID, the handheld shows "Badge not recognized."

| Check | Action |
|-------|--------|
| Is the operator set up in the system? | Open admin dashboard → Operators tab → search for the person |
| Does the badge UID match? | Compare the scanned UID to what's stored in the operator record |
| Has the handheld synced recently? | Ask the user to pull down to refresh / reconnect to WiFi and retry |
| Is this a new badge? | The badge needs to be registered first — see §3.6 |

**Resolution:** If the operator exists but the badge doesn't match, update the badge UID in the admin dashboard Operators tab. After updating, the handheld must sync to pick up the change.

---

### 4.2 "Invalid PIN" / "Too many attempts"

**What the user sees:** "Invalid PIN. X attempts left." or "Too many attempts. Wait Xs."

| Cause | Resolution |
|-------|------------|
| User forgot PIN | Reset PIN in admin dashboard → Operators tab → edit the operator |
| PIN lockout (5 failed attempts) | Wait 60 seconds, then retry with the correct PIN |
| PIN changed on server but handheld not synced | Connect to WiFi and sync the handheld |

**Resolution:** Reset the PIN from the admin dashboard. The user must sync their handheld before the new PIN takes effect.

---

### 4.3 "Equipment not found" when scanning barcode

**What the user sees:** "Equipment not found." or "No equipment found with that barcode." or "No equipment matched that scan."

| Check | Action |
|-------|--------|
| Is the equipment registered? | Admin dashboard → Equipment tab → search for it |
| Is the barcode label damaged? | Try manual entry of the barcode number |
| Has the handheld synced recently? | New equipment won't appear until the device syncs |
| Is the equipment at the correct site? | Equipment is filtered by the operator's assigned site |

**Resolution:** If the equipment isn't registered, add it in the admin dashboard Equipment tab. After adding, handhelds must sync to see it.

---

### 4.4 "NFC read failed. Try again."

**What the user sees:** "NFC read failed. Try again." when trying to scan a badge or equipment tag.

| Check | Action |
|-------|--------|
| Is NFC enabled on the device? | Settings → Connected Devices → NFC must be ON |
| Is the badge/tag positioned correctly? | Hold the badge flat against the NFC reader area on the back of the device |
| Is the NFC tag damaged? | Try scanning a known-good badge to isolate the issue |
| Is the browser up to date? | NFC Web API requires Chrome 89+ on Android |
| Is the native app installed? | The native app provides broader NFC tag support than the browser — see §10.5 |

**Resolution:** If NFC consistently fails, the user can switch to **manual entry** — tap the keyboard icon and type the badge UID or barcode manually.

---

### 4.5 Handheld app won't load / shows blank screen

| Check | Action |
|-------|--------|
| Is the device connected to WiFi? | The app must be loaded initially over the network (PWA caches after first load) |
| Has the PWA been installed? | Check if the PEC icon is on the home screen |
| Clear browser cache | Settings → Apps → Chrome → Clear Cache |
| Is the CRAW service running? | See §6.1 |
| Is the native app showing settings instead? | See §11.1 — the app may need server configuration |

**Resolution:** Clear the browser cache and reload. If the PWA was previously installed, it may work offline from cache, but needs connectivity for the initial load and periodic sync.

---

### 4.6 "Sync failed" / sessions stuck in pending

**What the user sees:** Sync status shows an error or completed sessions don't appear in the admin dashboard.

| Check | Action |
|-------|--------|
| Is the device connected to WiFi? | Sessions queue locally and sync when online |
| Is the CRAW service running? | See §6.1 |
| How many sessions are pending? | Check the sync status indicator on the handheld home screen |

**Resolution:**
1. Ensure WiFi connectivity
2. Force a sync by pulling down to refresh on the handheld
3. If sessions remain stuck, check server logs for `/api/sync` errors (see §8.2)
4. **Do not clear app data** — this will lose any unsent sessions. Escalate first.

> **CRITICAL:** Never clear the handheld browser/app data without first confirming all sessions have synced. Unsynced sessions stored only in IndexedDB will be permanently lost.

---

### 4.7 Photos not uploading / missing from reports

**What the user sees:** Defect photos taken during inspection don't appear in the admin dashboard reports.

| Check | Action |
|-------|--------|
| Did the sync complete? | Photos are sent as part of the session sync |
| Check server logs for photo errors | Search for "Failed to save photo" in CRAW logs |
| Disk space on server | Photos are stored on the server filesystem |
| Was camera permission granted? | On the native app: Settings → Apps → Power Equipment Checkout → Permissions → Camera |

**Resolution:** If the session synced but photos are missing, check server logs. The photo save path is inside the module's data directory.

---

### 4.8 Equipment is locked but shouldn't be

**What the user sees:** Scanning an equipment barcode shows it as locked out and won't allow checkout.

**Resolution:**
1. Open admin dashboard → **Locked Equipment** tab
2. Find the equipment and review who locked it and why
3. If it should be unlocked, click **Unlock**, confirm, and enter resolution notes
4. The handheld will pick up the change on next sync

---

## 5. Troubleshooting by Symptom — Admin Dashboard

### 5.1 "I can't access the admin dashboard"

| Check | Action |
|-------|--------|
| Can you reach https://biapps01.abarta.com:8443/? | If no, CRAW service may be down. See §6.1. |
| Do you get a 401/403? | User's AD account may not be in `ABARTA\ACCB_PEC_USERS` or `ABARTA\ACCB_DEPTS_IT-M` |
| Can others access it? | If yes → permissions issue. If no → service issue. |

**Resolution:** Verify AD group membership. If the user needs access, submit an AD group change request for `ABARTA\ACCB_PEC_USERS`.

---

### 5.2 "Badge is already assigned to {name}. Remove it from their account first."

**What the user sees:** When trying to assign a badge to an operator, error 409: "Badge is already assigned to {name}."

**Resolution:**
1. Go to **Operators** tab → find the operator who currently has the badge
2. Edit that operator and remove or change their badge UID
3. Save, then assign the badge to the new operator

---

### 5.3 "PINs do not match"

**What the user sees:** When creating/editing an operator in the admin dashboard, "PINs do not match."

**Resolution:** Re-enter the PIN in both the PIN and Confirm PIN fields, ensuring they match exactly. PINs must be 4–8 digits.

---

### 5.4 "Failed to load pending badges"

**What the user sees:** The pending badges section of the Operators tab shows an error.

**Resolution:** Refresh the page. If the error persists, check that the CRAW service is running and there are no Snowflake connectivity issues (see §8).

---

### 5.5 "Item text is required" / "Save failed" / "Delete failed" (Checklist Items)

| Error | Cause | Resolution |
|-------|-------|------------|
| `Item text is required` | Checklist item description field is empty | Enter the inspection question text |
| `Save failed` | Server couldn't save the checklist item | Check CRAW logs for Snowflake errors |
| `Delete failed` | Server couldn't delete the checklist item | Check CRAW logs for Snowflake errors |

---

### 5.6 Data not appearing after changes

**What the user sees:** Added/edited records don't show up in the dashboard tables.

| Check | Action |
|-------|--------|
| Did you click Save? | Ensure changes were submitted |
| Refresh the page | Press F5 or click the tab again |
| Is the site filter set? | The dashboard filters by site — check the site dropdown at the top |

---

## 6. Troubleshooting by Symptom — Infrastructure

### 6.1 CRAW Service Down

**Symptoms:** Both admin dashboard and handheld app are unreachable; all PEC URLs return connection errors.

```cmd
REM Check service status
sc query CRAW

REM Restart the service
net stop CRAW
net start CRAW
```

> **Note:** Handheld devices that have the PWA cached may continue to work offline for inspections. Sessions will queue locally and sync when the service is restored.

---

### 6.2 SQLite Cache Issues

PEC uses a local SQLite database as a read cache in front of Snowflake. If the cache becomes corrupted:

**Server log message:** `PowerEquipCheckout: Cache init failed — will use direct Snowflake`

**Resolution:** The module falls back to direct Snowflake queries automatically. To restore the cache:
1. Stop the CRAW service
2. Delete the SQLite cache file: `C:\craw\modules\powerequipcheckout\pec-cache.db`
3. Start the CRAW service — the cache will be recreated on startup

---

### 6.3 Snowflake Connectivity Issues

**Symptoms:** Dashboard loads but tables are empty or show errors; synced sessions don't appear.

**Server log message:** Snowflake connection errors in CRAW logs.

**Resolution:**
1. Check CRAW logs for Snowflake error messages (see §8.2)
2. Verify Snowflake connectivity from the server
3. Contact DBA team if Snowflake is down or credentials have changed

---

### 6.4 Background Push Service Failures

PEC uses a background service (`PecPushService`) to push data from the SQLite cache to Snowflake. If this fails:

**Server log messages:**
- `PEC background push cycle failed`
- `PEC push equipment {Id} failed`
- `PEC push operator {Id} failed`
- `PEC push session {Id} failed`
- `PEC push corrective action {Id} failed`
- `PEC push site {Id} failed`
- `PEC push lockout reason {Id} failed`

**Resolution:** These errors usually indicate Snowflake connectivity issues. The push service retries automatically on the next cycle. Check Snowflake connectivity and CRAW logs.

---

## 7. Error Message Reference

### 7.1 Handheld App Error Messages

| Error Message | Where Shown | Cause | Resolution |
|---------------|------------|-------|------------|
| `Enter a badge UID.` | Login screen | Manual UID field is empty | Enter the badge UID |
| `Badge not recognized.` | Login screen | Badge UID not found in local operator database | Sync the device or add the operator in admin dashboard |
| `NFC read failed. Try again.` | Login / scan screens | NFC hardware or tag read error | Retry; use manual entry as fallback |
| `Too many attempts. Wait {n}s.` | PIN entry | 5 failed PIN attempts — 60-second lockout | Wait for the lockout to expire |
| `Invalid PIN. {n} attempts left.` | PIN entry | Wrong PIN entered | Re-enter correct PIN; reset via admin if forgotten |
| `No sites configured. Create a site first.` | Admin menu | No active sites in the system | Create a site from the admin dashboard or handheld admin menu |
| `Equipment not found.` | Checkout / supervisor check | Scanned barcode not in local equipment database | Sync device or add equipment in admin dashboard |
| `No equipment matched that scan.` | NFC equipment scan | NFC tag UID doesn't match any equipment barcode | Use manual barcode entry instead |
| `No equipment found with that barcode.` | Manual barcode entry | Typed barcode not found | Verify the barcode number and try again |
| `No specific instructions available.` | Failed checklist item | No failure instructions configured for this item | Contact admin to add instructions in Checklist Items tab |
| `Name is required.` | User creation form | Name field is empty | Enter the operator's name |
| `PIN is required for new user.` | User creation form | PIN field is empty | Enter a 4–8 digit PIN |
| `PIN must be 4-8 digits.` | User creation / supervisor creation | PIN doesn't meet format requirements | Enter a numeric PIN between 4 and 8 digits |
| `Site is required.` | Supervisor creation | Site field is empty | Select a site |
| `Code and name are required.` | Site creation | Missing site code or name | Fill in both fields |
| `Save failed.` | Various save operations | Server returned an error | Check WiFi connectivity; retry |
| `Network error.` | Various operations | Device can't reach the server | Connect to WiFi and retry |
| `Check failed.` | Supervisor check | Server error during spot check | Check WiFi; retry |
| `No inspection on record` | Supervisor check result | No recent checkout session for this equipment | Equipment hasn't been inspected recently |
| `Not a supervisor badge.` | Badge registration | Attempted auth with non-supervisor badge | Use a supervisor or admin badge |
| `Failed to submit. Are you online?` | Badge registration | Network error during badge submission | Connect to WiFi and retry |

### 7.2 Admin Dashboard Error Messages

| Error Message | Where Shown | Cause | Resolution |
|---------------|------------|-------|------------|
| `PINs do not match.` | Operator form | PIN and Confirm PIN fields differ | Re-enter matching PINs |
| `Badge is already assigned to {name}. Remove it from their account first.` | Operator form | Duplicate badge UID | Remove the badge from the other operator first |
| `Failed to load pending badges.` | Operators tab | API error loading pending badge registrations | Refresh page; check CRAW service |
| `Item text is required` | Checklist item form | Description field is empty | Enter the checklist question text |
| `Save failed` | Checklist / site / reason forms | Server error during save | Check CRAW logs for details |
| `Delete failed` | Checklist item deletion | Server error during delete | Check CRAW logs for details |
| `PIN is required for new operators` | Operator creation API | No PIN provided for a new operator | Enter a PIN in the operator form |

### 7.3 Server API Error Responses

| Error | HTTP Status | Endpoint | Cause |
|-------|------------|----------|-------|
| `badgeUid is required` | 400 | POST /api/badge-scan | Missing badge UID in request |
| `PIN is required for new operators` | 400 | POST /api/operators | Creating operator without PIN |
| `Badge is already assigned to {name}...` | 409 | POST /api/operators | Duplicate badge UID collision |
| `sessions array required` | 400 | POST /api/sync | Sync payload malformed |
| `supervisorId and equipmentId are required` | 400 | POST /api/supervisor-check | Missing required fields |
| `Equipment not found` | 404 | POST /api/supervisor-check | Equipment ID doesn't exist |
| `Session not found` | 404 | GET /api/report/{id} | Report for non-existent session |
| *(no body)* | 405 | Various | Unsupported HTTP method on endpoint |

### 7.4 Server Log Messages (Not User-Visible)

| Log Message | Severity | Meaning | Action |
|-------------|----------|---------|--------|
| `Could not ensure tables on init (may need manual DDL)` | Warning | Snowflake DDL failed at startup | Check Snowflake permissions; may need manual table creation |
| `Cache init failed — will use direct Snowflake` | Warning | SQLite cache couldn't initialize | Module falls back gracefully; delete cache file and restart to fix |
| `Could not seed admin to Snowflake` | Warning | Initial admin account seeding failed | Usually non-critical if admin already exists |
| `Failed to save photo for session {id} item {id}` | Warning | Photo write to disk failed | Check disk space and file permissions |
| `PEC background push cycle failed` | Warning | Entire push cycle to Snowflake failed | Check Snowflake connectivity |
| `PEC push {type} {id} failed` | Warning | Individual record push to Snowflake failed | Will retry next cycle; check Snowflake if persistent |

---

## 8. Server-Side Diagnostics

### 8.1 Checking the CRAW Service

```cmd
REM Check service status
sc query CRAW

REM Restart the service
net stop CRAW
net start CRAW
```

### 8.2 Checking CRAW Logs

**Log location:** `C:\usr\craw\logs\craw-YYYYMMDD.log`

```cmd
REM Search for PEC-specific entries
powershell -c "Select-String 'PowerEquipCheckout|PEC' 'C:\usr\craw\logs\craw-20260813.log'"

REM Search for errors
powershell -c "Select-String 'ERR|Error|Exception' 'C:\usr\craw\logs\craw-20260813.log'"

REM Search for push service issues
powershell -c "Select-String 'PEC push|PEC background' 'C:\usr\craw\logs\craw-20260813.log'"
```

### 8.3 Checking Snowflake

```sql
-- Check recent checkout sessions
SELECT s.SESSION_ID, o.NAME AS OPERATOR, e.NAME AS EQUIPMENT,
       s.STATUS, s.CHECKOUT_TIME, s.SITE_CODE
FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_CHECKOUT_SESSION s
LEFT JOIN DB_BI_P_EDW.ABARTA_GENERAL.PEC_OPERATOR o ON s.OPERATOR_ID = o.OPERATOR_ID
LEFT JOIN DB_BI_P_EDW.ABARTA_GENERAL.PEC_EQUIPMENT e ON s.EQUIPMENT_ID = e.EQUIPMENT_ID
ORDER BY s.CHECKOUT_TIME DESC
LIMIT 20;

-- Check locked equipment
SELECT e.NAME, e.BARCODE, e.LOCKED_REASON, e.LOCKED_BY, e.LOCKED_AT
FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_EQUIPMENT e
WHERE e.IS_LOCKED = TRUE;

-- Check operators
SELECT OPERATOR_ID, NAME, BADGE_UID, ROLE, SITE_CODE, IS_ACTIVE
FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_OPERATOR
ORDER BY NAME;

-- Check corrective actions
SELECT ca.*, e.NAME AS EQUIPMENT_NAME
FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_CORRECTIVE_ACTION ca
LEFT JOIN DB_BI_P_EDW.ABARTA_GENERAL.PEC_EQUIPMENT e ON ca.EQUIPMENT_ID = e.EQUIPMENT_ID
ORDER BY ca.CREATED_AT DESC
LIMIT 20;

-- Check active sites
SELECT * FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_SITE
WHERE IS_ACTIVE = TRUE;

-- Check supervisor spot-checks
SELECT sc.*, o.NAME AS SUPERVISOR_NAME, e.NAME AS EQUIPMENT_NAME
FROM DB_BI_P_EDW.ABARTA_GENERAL.PEC_SUPERVISOR_CHECK sc
LEFT JOIN DB_BI_P_EDW.ABARTA_GENERAL.PEC_OPERATOR o ON sc.SUPERVISOR_ID = o.OPERATOR_ID
LEFT JOIN DB_BI_P_EDW.ABARTA_GENERAL.PEC_EQUIPMENT e ON sc.EQUIPMENT_ID = e.EQUIPMENT_ID
ORDER BY sc.CHECK_TIME DESC
LIMIT 20;
```

### 8.4 Key File Locations

| File | Path | Purpose |
|------|------|---------|
| CRAW Service | `C:\craw\service\CRAW.Server.exe` | Main service executable |
| Module DLL | `C:\craw\modules\powerequipcheckout\CRAW.PowerEquipCheckout.dll` | Module code |
| Module Config | `C:\craw\modules\powerequipcheckout\appsettings.json` | Module settings (DB, roles, mobile auth) |
| SQLite Cache | `C:\craw\modules\powerequipcheckout\pec-cache.db` | Local data cache |
| CRAW Logs | `C:\usr\craw\logs\craw-YYYYMMDD.log` | Rolling daily log files |

### 8.5 Snowflake Tables

| Table | Purpose |
|-------|---------|
| `PEC_EQUIPMENT` | Equipment inventory (forklifts, trucks, etc.) |
| `PEC_OPERATOR` | Operators, supervisors, admins with badges and PINs |
| `PEC_SHIFT` | Shift definitions |
| `PEC_CHECKLIST_TEMPLATE` | Checklist template groups |
| `PEC_CHECKLIST_ITEM` | Individual inspection questions |
| `PEC_CHECKOUT_SESSION` | Completed inspection sessions |
| `PEC_SESSION_ITEM` | Individual checklist item results per session |
| `PEC_CORRECTIVE_ACTION` | Corrective actions for failed inspections |
| `PEC_SUPERVISOR_CHECK` | Supervisor spot-check audit records |
| `PEC_SITE` | Distribution center / site locations |
| `PEC_LOCKOUT_REASON` | Lockout reason categories |

---

## 9. Escalation Guide

### When to Escalate

| Situation | Escalate To |
|-----------|------------|
| CRAW service won't start | Infrastructure / Mark Kaufmann |
| Module not loading (no PEC log entries) | Mark Kaufmann |
| Snowflake connectivity issues | DBA Team / Infrastructure |
| SQLite cache corruption (repeated) | Mark Kaufmann |
| Handheld devices can't connect to WiFi | Infrastructure / Warehouse IT |
| NFC hardware not working on device | Device vendor / Warehouse IT |
| New AD group membership needed | Active Directory Admin |
| Push service persistently failing | Mark Kaufmann |
| Unsynced sessions stuck on device | Mark Kaufmann (data recovery) |
| Photo storage issues | Infrastructure (disk space) / Mark Kaufmann |
| Need to modify checklist items | Warehouse Safety Manager / Mark Kaufmann |
| Native app NFC not working after troubleshooting | Mark Kaufmann |
| Need new device token for a handheld | Mark Kaufmann (server config) |
| SSL certificate expired in bundled app | Mark Kaufmann (new APK build required) |
| App won't install on device (compatibility) | Warehouse IT / Mark Kaufmann |
| Need to deploy updated APK to devices | Warehouse IT (MDM) / Mark Kaufmann |

### Information to Gather Before Escalating

1. **Screenshot** of the error (handheld screen or admin dashboard)
2. **Timestamp** of when the issue occurred
3. **Device info** — which handheld device, is it connected to WiFi?
4. **App build version** — check the badge in the bottom-right corner of the native app (e.g., "2026.08.12-E")
5. **Operator name** and badge UID if applicable
6. **Equipment barcode** if related to a specific piece of equipment
7. **Site/DC location** where the issue occurred
8. **How many users affected** — is it one device or all devices?
9. **CRAW log excerpt** from the relevant timestamp (see §8.2)
10. **Sync status** — are there pending sessions on the handheld?
11. **Native app or browser?** — is the user using the installed Android app or Chrome browser?

### Immediate Actions the Helpdesk Can Take

| Action | How | When |
|--------|-----|------|
| Restart CRAW service | `net stop CRAW` then `net start CRAW` | Service down, module not loading |
| Reset operator PIN | Admin dashboard → Operators → Edit → set new PIN | Operator forgot PIN |
| Unlock equipment | Admin dashboard → Locked Equipment → Unlock | Equipment locked in error |
| Reassign badge | Admin dashboard → Operators → remove badge from old, assign to new | Badge reassignment |
| Clear SQLite cache | Delete `pec-cache.db` and restart CRAW service | Cache corruption |
| Check sync status | Ask user to check sync indicator on handheld home screen | Sessions not appearing |
| Configure app on new device | Launch app → enter server URL + device token | New device setup |
| Reset app configuration | Settings → Apps → Power Equipment Checkout → Clear Data → re-enter config | Wrong server URL or token |
| Enable NFC on device | Settings → Connected devices → NFC → ON | NFC disabled |
| Grant camera permission | Settings → Apps → Power Equipment Checkout → Permissions → Camera → Allow | Camera not working |
| Check app build version | Look at bottom-right corner badge in app | Identifying which build is installed |

### Contact

| Role | Contact | For |
|------|---------|-----|
| Module Owner | Mark Kaufmann (MKaufmann@abartacocacola.com) | Code issues, configuration, data recovery |
| Infrastructure | IT Infrastructure Team | Server, network, WiFi, certificates |
| DBA | BI/Snowflake Team | Database connectivity, permissions |
| Warehouse IT | Local DC IT contact | Device hardware, WiFi coverage, NFC issues |

---

## 10. Android Native App

### 10.1 App Overview

The PEC Android app is a **Capacitor-based native shell** that wraps the server-hosted handheld PWA. It is not a standalone app — the actual checkout workflow runs on the remote server. The native app provides:

| Capability | Implementation |
|-----------|----------------|
| **Native NFC** | Android foreground dispatch → `nfc-tag-discovered` JS event (replaces Web NFC API) |
| **Camera** | Capacitor Camera plugin for defect photos |
| **Server Configuration** | Local settings screen for server URL + device token (stored via Capacitor Preferences) |
| **SSL Trust** | Bundled server certificate for `biapps01.abarta.com` in addition to system/user CA trust |
| **Offline Shell** | Local HTML/JS cached in the APK for the settings screen |

### 10.2 App Identity & Versioning

| Property | Value |
|----------|-------|
| **Package ID** | `com.abarta.pec` |
| **App Name** | Power Equipment Checkout |
| **Android versionCode** | 1 |
| **Android versionName** | 1.0.0 |
| **JS UI version** | 1.0.1 |
| **Native build badge** | 2026.08.12-E (displayed as overlay in bottom-right of WebView) |
| **Min SDK** | 24 (Android 7.0 Nougat) |
| **Target SDK** | 36 |
| **Compile SDK** | 36 |

### 10.3 Android Permissions

| Permission | Required | Purpose |
|-----------|----------|---------|
| `INTERNET` | Yes | Network access to reach the PEC server |
| `NFC` | Yes (declared `required="true"`) | Badge and equipment tag scanning |
| `CAMERA` | No (declared `required="false"`) | Defect photos during failed checklist items |

> **Note:** Because NFC is declared as `required="true"`, the app will not install on devices without NFC hardware. This is intentional — warehouse handhelds must have NFC.

### 10.4 First-Run Setup

On first launch (or when server configuration is missing), the app displays a **Server Settings** screen:

1. **Server URL** — enter the PEC server base URL (e.g., `https://biapps01.abarta.com:8443/pec`)
2. **Device Token** — enter the device token assigned in the server's `appsettings.json` under `MobileAuth.Devices`
3. Tap **Test Connection** to verify the server is reachable
4. Tap **Save & Connect** to store settings and launch the handheld PWA

Settings are persisted locally via Capacitor Preferences and survive app restarts. The app will skip the settings screen on subsequent launches and go directly to the server-hosted PWA.

### 10.5 NFC Implementation (Native vs. Web)

The Android app **overrides the Web NFC API** with native Android NFC:

| Aspect | PWA (Browser) | Native Android App |
|--------|---------------|-------------------|
| NFC API | Web NFC `NDEFReader` (Chrome 89+) | Android `NfcAdapter` foreground dispatch |
| Tag Detection | Browser-managed | `MainActivity.onNewIntent()` intercepts NFC intents |
| JS Delivery | `NDEFReader.onreading` event | Custom `nfc-tag-discovered` DOM event with `tagId` in detail |
| Tag Format | Colon-separated uppercase hex UID | Same format (converted in Java) |
| Timeout | Browser-dependent | 30-second scan window (injected JS override) |
| Supported Tag Types | NDEF only | NfcA, NfcB, NfcF, NfcV, IsoDep, MifareClassic, MifareUltralight, Ndef, NdefFormatable |
| NFC Permission | Browser permission prompt | Android manifest — no runtime prompt needed |

> The native NFC path supports **more tag types** than Web NFC, which only handles NDEF. This means badge/equipment tags that don't work in a browser may work in the native app.

### 10.6 Capacitor Plugins

| Plugin | Purpose |
|--------|---------|
| `@capacitor/app` | App lifecycle events |
| `@capacitor/camera` | Defect photo capture (returns data URL) |
| `@capacitor/preferences` | Local key-value storage for server URL and device token |
| `@capacitor/splash-screen` | Launch splash screen |
| `@capacitor/status-bar` | Status bar styling (color, overlay) |
| `PecNfc` (custom) | Native NFC adapter status check (registered manually in MainActivity) |

### 10.7 Network & SSL Configuration

- **Cleartext traffic:** Disabled (HTTPS only)
- **Server trust:** `biapps01.abarta.com` is configured with a bundled certificate (`@raw/biapps01_cert`) in addition to system and user CA stores
- **In-WebView navigation:** Restricted to `biapps01.abarta.com` via Capacitor's `allowNavigation`
- **CapacitorHttp:** Enabled — routes `fetch()` calls through native HTTP layer (bypasses WebView CORS restrictions)
- **Mixed content:** Disabled (no HTTP resources allowed in HTTPS pages)

### 10.8 IndexedDB Local Database

The app uses IndexedDB (database name: `pec_handheld`, version 2) for offline data:

| Store | Key | Contents |
|-------|-----|----------|
| `operators` | `operatorId` | Operator records with badge UIDs, PIN hashes, roles |
| `equipment` | `equipmentId` | Equipment inventory with barcodes |
| `checklist` | `itemId` | Inspection checklist questions |
| `shifts` | `shiftId` | Shift definitions |
| `pendingSessions` | `clientGuid` | Completed inspections waiting to sync |
| `completedSessions` | `clientGuid` | Successfully synced inspection sessions |
| `sites` | `siteId` | Distribution center locations |
| `lockoutReasons` | `reasonId` | Lockout reason categories |

### 10.9 Sync Engine

| Setting | Value |
|---------|-------|
| **Auth header** | `X-Device-Token` |
| **Push endpoint** | `POST /api/sync` (sends `pendingSessions` array) |
| **Pull endpoints** | `GET /api/operators`, `/api/equipment`, `/api/checklist`, `/api/shifts`, `/api/sites`, `/api/lockout-reasons` |
| **Queue check interval** | 60 seconds |
| **Error retry delay** | 30 seconds |
| **Sync trigger** | Online event listener + periodic timer |

**Sync flow:**
1. **Push:** Pending sessions are POSTed to server → on success, moved to `completedSessions` store and deleted from `pendingSessions`
2. **Pull:** Reference data refreshed from server API endpoints → bulk-written to IndexedDB stores

### 10.10 App Lifecycle & NFC Dispatch

| Event | What Happens |
|-------|-------------|
| **App launches** | MainActivity registers PecNfc plugin, prepares NFC foreground dispatch, injects JS helpers |
| **App enters foreground (`onResume`)** | NFC foreground dispatch enabled — the app intercepts NFC intents |
| **App enters background (`onPause`)** | NFC foreground dispatch disabled — tag scans go to system default handler |
| **NFC tag detected** | Java extracts tag ID → converts to colon-separated uppercase hex → dispatches `nfc-tag-discovered` JS event |
| **WebView loads remote PWA** | JS overrides `PecAuth.readNfcBadge`, polyfills `NDEFReader`, forces NFC permission to granted |

---

## 11. Troubleshooting by Symptom — Android Native App

### 11.1 App Shows "Server Settings" Screen Instead of Launching

**What the user sees:** The app opens to a configuration form asking for Server URL and Device Token instead of the normal handheld checkout interface.

| Cause | Resolution |
|-------|------------|
| First-time setup on a new device | Enter the server URL and device token (see §10.4) |
| App data was cleared | Re-enter configuration. **WARNING:** clearing app data also deletes IndexedDB — any unsynced sessions are lost |
| App was reinstalled | Re-enter configuration |

**Standard configuration values:**
- **Server URL:** `https://biapps01.abarta.com:8443/pec`
- **Device Token:** Obtain from the server's `appsettings.json` → `MobileAuth` → `Devices` section, or contact Mark Kaufmann

---

### 11.2 "Connection failed" When Testing Server Connection

**What the user sees:** After tapping **Test Connection**, the app shows "Connection failed: {error details}."

| Check | Action |
|-------|--------|
| Is the device connected to WiFi? | Check WiFi settings on the device |
| Is the server URL correct? | Must include `https://` and port `:8443` — e.g., `https://biapps01.abarta.com:8443/pec` |
| Is the device token correct? | Verify against server config |
| Is the CRAW service running? | See §6.1 |
| Is the server certificate valid? | If the bundled cert expired, the app needs an update with a new cert |

---

### 11.3 "NFC is disabled - enable in Settings" Toast

**What the user sees:** A toast message appears at the bottom of the screen saying "NFC is disabled - enable in Settings."

**Resolution:**
1. Open Android **Settings** → **Connected devices** → **Connection preferences** → **NFC**
2. Toggle NFC **ON**
3. Return to the PEC app — NFC will be active immediately

---

### 11.4 NFC Badge Scan Not Working (No Response When Tapping)

**What the user sees:** Tapping a badge on the device produces no response — no error, no scan result.

| Check | Action |
|-------|--------|
| Is NFC enabled? | Settings → Connected devices → NFC must be ON |
| Is the PEC app in the foreground? | NFC foreground dispatch only works when the app is the active window |
| Is the screen on and unlocked? | NFC won't work with screen off or locked |
| Is the badge positioned correctly? | Hold flat against the NFC antenna area (usually upper back of device) |
| Has the app been minimized and returned? | NFC dispatch is re-enabled on resume — this should work automatically |
| Is the tag type supported? | The app supports NfcA, NfcB, NfcF, NfcV, IsoDep, Mifare, and NDEF tags |

**Resolution:** If NFC consistently fails with the native app, try restarting the app. If the issue persists, restart the device. As a last resort, use manual badge UID entry.

---

### 11.5 App Stuck on Blank White Screen After Configuration

**What the user sees:** After saving settings, the app shows a blank white screen instead of the handheld PWA.

| Check | Action |
|-------|--------|
| Is the server reachable? | Test from another device or browser |
| Was the URL entered correctly? | Common mistakes: missing `https://`, wrong port, trailing spaces |
| Check the device token | An invalid token may cause the server to reject the connection |
| Is the server certificate trusted? | If the bundled cert is expired/wrong, the WebView may refuse to load |

**Resolution:**
1. Force-close the app and reopen
2. If the settings screen reappears, verify the URL and token
3. If the settings don't reappear (config was saved), clear app data to reset: **Settings → Apps → Power Equipment Checkout → Storage → Clear Data**
4. Re-enter the correct server URL and token

> **WARNING:** Clearing app data deletes IndexedDB. Ensure all sessions have synced before clearing.

---

### 11.6 Camera Not Working for Defect Photos

**What the user sees:** The camera doesn't open when trying to take a defect photo, or the photo isn't captured.

| Check | Action |
|-------|--------|
| Has the app been granted camera permission? | Settings → Apps → Power Equipment Checkout → Permissions → Camera must be allowed |
| Was the permission prompt dismissed? | If the user denied the permission, it must be enabled manually in Settings |
| Is the camera hardware working? | Test with the device's built-in camera app |

**Resolution:** Grant camera permission in Android Settings. The camera is declared as `required="false"`, so the app installs on devices without cameras, but photo capture will not work without one.

---

### 11.7 "Upgrade blocked — close other tabs and reload"

**What the user sees:** This error can appear if the IndexedDB database schema needs to upgrade but another instance has it open.

**Resolution:**
1. Close all other browser tabs or app instances that might have the PEC handheld open
2. Force-close the PEC app
3. Reopen the app

> This typically happens if the PWA was also open in Chrome on the same device while the native app was running.

---

### 11.8 Build Version Badge Overlapping UI

**What the user sees:** A small version badge (e.g., "2026.08.12-E") appears in the bottom-right corner of the screen, potentially overlapping content.

**Explanation:** This is an intentional build identifier injected by the native app for troubleshooting purposes. It helps identify which app build is installed on a device.

**Resolution:** This is expected behavior and cannot be removed by the user. If the badge obscures critical UI elements, report to Mark Kaufmann for a layout adjustment.

---

### 11.9 App Doesn't Install — "Device not compatible"

**What the user sees:** Google Play or sideload installation fails with a compatibility error.

| Check | Action |
|-------|--------|
| Does the device have NFC? | The app requires NFC hardware (`required="true"`) — it won't install on devices without NFC |
| Is the Android version 7.0+? | Min SDK is 24 (Android 7.0 Nougat) |

**Resolution:** The device must have NFC hardware and run Android 7.0 or later. Contact Warehouse IT for a compatible device.

---

### 11.10 App Crashes or Force Closes

**What the user sees:** The app closes unexpectedly or shows "Power Equipment Checkout has stopped."

| Check | Action |
|-------|--------|
| Is the device low on memory? | Close other apps and retry |
| Is the Android WebView component up to date? | Play Store → search "Android System WebView" → Update |
| Does the crash happen on a specific action? | Note the exact step that triggers the crash for escalation |

**Resolution:**
1. Force-close the app and reopen
2. If persistent, update Android System WebView via the Play Store
3. If still crashing, clear app cache (NOT data): **Settings → Apps → Power Equipment Checkout → Storage → Clear Cache**
4. Escalate to Mark Kaufmann with the crash details and device model

---

## 12. Error Message Reference — Android Native App

### 12.1 Native App Settings Screen Messages

| Message | Where Shown | Cause | Resolution |
|---------|------------|-------|------------|
| `Server URL is required.` | Settings screen | URL field is empty when saving | Enter the server URL |
| `Device Token is required.` | Settings screen | Token field is empty when saving | Enter the device token |
| `Enter a URL first.` | Settings screen | URL field is empty when testing | Enter a URL before testing |
| `Enter a device token.` | Settings screen | Token field is empty when testing | Enter a token before testing |
| `✓ Server is reachable! Hit Save & Connect to launch.` | Settings screen | Connection test succeeded | Tap Save & Connect to proceed |
| `Connection failed: {error}` | Settings screen | Server unreachable or error | Check WiFi, URL, token, and server status |
| `Saving...` | Settings screen | Configuration being saved | Wait for completion |
| `Launching...` | Settings screen | App navigating to server PWA | Wait for the handheld interface to load |
| `Testing...` | Settings screen | Connection test in progress | Wait for result |

### 12.2 Native Toast Messages

| Message | Cause | Resolution |
|---------|-------|------------|
| `NFC is disabled - enable in Settings` | Device NFC adapter is off | Enable NFC in Android Settings |

### 12.3 Console/Debug Messages (Not User-Visible)

These appear in Android logcat or remote Chrome DevTools (`chrome://inspect`) and are useful for developer debugging:

| Message | Source | Meaning |
|---------|--------|---------|
| `[PEC] Boot error: {error}` | app.js | App initialization failed |
| `[PEC] Navigating to PWA: {url}` | app.js | App redirecting to server URL |
| `[NFC] Android NFC bridge installed` | nfc-native.js | Native NFC override activated successfully |
| `[NFC] Tag detected: {uid}` | nfc-native.js | NFC tag successfully read |
| `[NFC] Could not start native listener: {error}` | nfc-native.js | NFC listener setup failed |
| `[PecNative] Preferences read error: {error}` | capacitor-bridge.js | Failed to read stored settings |
| `[PecNative] Camera error: {error}` | capacitor-bridge.js | Camera capture failed |
| `[PecNative] isNative: {boolean}` | capacitor-bridge.js | Platform detection result |
| `Sync failed: {error}` | sync.js | Sync POST/pull operation failed |
| `Sync POST failed: {status}` | sync.js | Server returned non-OK HTTP status during sync |

### 12.4 Debugging with Chrome DevTools

To inspect the app's WebView remotely:

1. Connect the device to a computer via USB
2. Enable **Developer Options** and **USB Debugging** on the device
3. Open Chrome on the computer and navigate to `chrome://inspect`
4. The PEC WebView should appear under **Remote Target**
5. Click **Inspect** to open DevTools
6. Check the **Console** tab for the debug messages listed in §12.3
7. Check the **Application** tab → **IndexedDB** → `pec_handheld` to inspect local data and sync state

---

## 13. Android App Deployment & Updates

### 13.1 Build Process

The app uses Gradle with Android Gradle Plugin 8.13.0 and Gradle 8.14.3.

```cmd
REM Navigate to the Android project directory
cd C:\usr\prg\pec-android\pec-android\pec-android-project\pec-android\android

REM Build debug APK
gradlew assembleDebug

REM Build release APK (signing must be configured first — see §13.4)
gradlew assembleRelease
```

**Debug APK output:** `app\build\outputs\apk\debug\app-debug.apk`  
**Release APK output:** `app\build\outputs\apk\release\app-release.apk`

> **Note:** Release signing is currently commented out in the build config. A signing keystore must be configured before producing a signed release APK for distribution.

### 13.2 What Requires an App Update vs. Server-Side Change

| Update Type | What Changes | Requires New APK? |
|------------|-------------|-------------------|
| Checkout workflow changes | Server-hosted PWA code | **No** — changes are live on the server |
| Checklist item changes | Server database | **No** — pulled via sync |
| Operator/equipment changes | Server database | **No** — pulled via sync |
| NFC behavior changes | Native Java code (`MainActivity.java`, `PecNfcPlugin.java`) | **Yes** |
| Camera behavior changes | Native plugin code | **Yes** |
| Server URL change | Local app config | Re-configure in app settings (clear data + re-enter) |
| SSL certificate rotation | Bundled `@raw/biapps01_cert` | **Yes** |
| New Capacitor plugin added | Native + JS code | **Yes** |
| Build version badge update | `MainActivity.java` → `BUILD_VERSION` | **Yes** |
| Local settings UI changes | `www/js/app.js`, `www/index.html` | **Yes** |

### 13.3 Key Files for App Updates

| File | Path | When to Update |
|------|------|---------------|
| Build version badge | `MainActivity.java` → `BUILD_VERSION` constant | Every release build |
| JS UI version | `www/js/app.js` → version string | When local shell UI changes |
| Android version | `android/app/build.gradle` → `versionCode`/`versionName` | Every release (increment `versionCode`) |
| Bundled SSL cert | `android/app/src/main/res/raw/biapps01_cert` | When server certificate rotates |
| Capacitor config | `capacitor.config.ts` | When server URL or plugin config changes |
| Network security | `android/app/src/main/res/xml/network_security_config.xml` | When server domain or cert trust changes |

### 13.4 Release Signing

Release signing is configured via environment variables in `android/app/build.gradle` (currently commented out). To enable:

1. Generate a keystore: `keytool -genkey -v -keystore pec-release.keystore -alias pec -keyalg RSA -keysize 2048 -validity 10000`
2. Set environment variables:
   - `PEC_KEYSTORE_PATH` — path to the keystore file
   - `PEC_KEYSTORE_PASSWORD` — keystore password
   - `PEC_KEY_ALIAS` — key alias (e.g., `pec`)
   - `PEC_KEY_PASSWORD` — key password
3. Uncomment the signing config in `android/app/build.gradle`
4. Build with `gradlew assembleRelease`

### 13.5 Sideloading an APK

For warehouse devices not managed through Google Play:

1. Build the debug or release APK (see §13.1)
2. Transfer the APK to the device (USB, file share, or MDM)
3. On the device: **Settings → Security → Install unknown apps** → allow the file manager
4. Open the APK file on the device and tap **Install**
5. Launch the app and configure server settings (§10.4)

### 13.6 Updating Web Assets After Server-Side Changes

The local web assets (`www/` directory) are only used for the settings screen. After editing files in `www/`:

```cmd
REM Sync www assets into the Android project
cd C:\usr\prg\pec-android\pec-android\pec-android-project\pec-android
npx cap sync android

REM Then rebuild the APK
cd android
gradlew assembleDebug
```

### 13.7 Verifying the Installed Build

To check which version is installed on a device:
- **Build badge:** Look at the bottom-right corner overlay in the app (e.g., "2026.08.12-E")
- **Android settings:** Settings → Apps → Power Equipment Checkout → version number
- **ADB:** `adb shell dumpsys package com.abarta.pec | findstr versionName`
