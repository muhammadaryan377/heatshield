# Screen 1 functional acceptance

This QA branch exists to run the same CI checks against the current functional Home implementation.

Acceptance flow:

- first launch returns zero sites and zero workers
- create a site from a user-drawn polygon
- select among multiple saved sites
- do not show environmental numbers without a verified FortyGuard observation
- add a worker to the selected site and persist the exact map position
- show only saved workers on Home
- request live FortyGuard heatmap + environmental parameters for the selected site
