# Camera upload labels follow the stage perspective

Date: 2026-10-29. Accepted under explicit user request to update and deploy /upload.

Camera crews record from the stage facing the crowd. Their Left selection must identify the crowd on their own left, so /upload displays stage-facing-audience labels and sends the opposite canonical audience column: Left → right, Center → center, Right → left. Store canonical values in UI selection state; duplicate checks and upload request bodies continue using those values. Convert received-upload labels back to the stage view as well.

Canonical map coordinates, optical manifests, admin Audience column controls, stored recordings and audience manual music sections keep their existing audience-facing-stage convention. No contract or data migration is needed. One explicit option map in the camera-upload client module is used by both the picker and received list. Request/receipt regression tests cover all three choices. Actual optical/physical checks remain separate from UI/request verification.
