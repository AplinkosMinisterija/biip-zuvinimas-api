# BIIP Žuvinimas API — Context

**biip-zuvinimas-api** is the backend service for Lithuania's fish stocking management platform, operated by the Environment Protection Agency. It tracks planned stockings on water bodies (lakes, rivers, ponds), inspections by authorized users, and personnel data. The service enforces role-based access (freelancer/tenant/admin) and integrates with the national UETK cadastre of water objects and the GRPK topographic database.

## Domain glossary

| Lithuanian term | Code identifier | Meaning |
|---|---|---|
| neregistruotas telkinys | `pendingLocation` | A real water body absent from UETK, staged until registered via AAA |
| rezervuotas kadastro ID | `NR-######` | Temporary identifier minted on administrator approval; prefix reserved to avoid collision with UETK ids |
| GRPK pasiūlymas | `GRPK_CANDIDATE` | Name and geometry proposed from the GRPK topographic database, not yet selectable or approved |
