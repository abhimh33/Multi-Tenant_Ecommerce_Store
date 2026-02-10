{{/*
Shared template helpers for the ecommerce-store chart.
All naming, labeling, and selector logic is centralized here.
*/}}

{{/*
Expand the chart name.
*/}}
{{- define "ecommerce-store.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name — uses storeId as the primary identifier.
*/}}
{{- define "ecommerce-store.fullname" -}}
{{- if .Values.storeId }}
{{- .Values.storeId | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/*
Common labels applied to every resource.
*/}}
{{- define "ecommerce-store.labels" -}}
helm.sh/chart: {{ include "ecommerce-store.name" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: mt-ecommerce
mt-ecommerce/store-id: {{ .Values.storeId | default .Release.Name }}
mt-ecommerce/engine: {{ .Values.engine }}
{{- end }}

{{/*
WordPress-specific labels.
*/}}
{{- define "ecommerce-store.wordpress.labels" -}}
{{ include "ecommerce-store.labels" . }}
app.kubernetes.io/name: wordpress
app.kubernetes.io/component: frontend
{{- end }}

{{/*
WordPress selector labels (must be immutable after creation).
*/}}
{{- define "ecommerce-store.wordpress.selectorLabels" -}}
app.kubernetes.io/name: wordpress
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
MariaDB-specific labels.
*/}}
{{- define "ecommerce-store.mariadb.labels" -}}
{{ include "ecommerce-store.labels" . }}
app.kubernetes.io/name: mariadb
app.kubernetes.io/component: database
{{- end }}

{{/*
MariaDB selector labels.
*/}}
{{- define "ecommerce-store.mariadb.selectorLabels" -}}
app.kubernetes.io/name: mariadb
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Medusa-specific labels.
*/}}
{{- define "ecommerce-store.medusa.labels" -}}
{{ include "ecommerce-store.labels" . }}
app.kubernetes.io/name: medusa
app.kubernetes.io/component: backend
{{- end }}

{{/*
Medusa selector labels.
*/}}
{{- define "ecommerce-store.medusa.selectorLabels" -}}
app.kubernetes.io/name: medusa
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Generate the WordPress database name.
*/}}
{{- define "ecommerce-store.wordpress.dbName" -}}
{{- default "wordpress" .Values.wordpress.db.name }}
{{- end }}

{{/*
Generate the MariaDB service hostname (cluster-internal DNS).
*/}}
{{- define "ecommerce-store.mariadb.serviceName" -}}
{{- printf "%s-mariadb" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Generate the WordPress service hostname.
*/}}
{{- define "ecommerce-store.wordpress.serviceName" -}}
{{- printf "%s-wordpress" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Generate the ingress hostname for this store.
*/}}
{{- define "ecommerce-store.ingress.host" -}}
{{- if .Values.ingress.host }}
{{- .Values.ingress.host }}
{{- else }}
{{- printf "%s%s" (.Values.storeId | default .Release.Name) .Values.ingress.hostSuffix }}
{{- end }}
{{- end }}

{{/*
Alias for ingress host — used by templates as "ingressHost".
*/}}
{{- define "ecommerce-store.ingressHost" -}}
{{- include "ecommerce-store.ingress.host" . }}
{{- end }}

{{/*
Generate the Medusa service hostname.
*/}}
{{- define "ecommerce-store.medusa.serviceName" -}}
{{- printf "%s-medusa" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Secret name for MariaDB credentials.
*/}}
{{- define "ecommerce-store.mariadb.secretName" -}}
{{- printf "%s-mariadb-secret" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Secret name for WordPress credentials.
*/}}
{{- define "ecommerce-store.wordpress.secretName" -}}
{{- printf "%s-wordpress-secret" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Secret name for Medusa application credentials.
*/}}
{{- define "ecommerce-store.medusa.secretName" -}}
{{- printf "%s-medusa-secret" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Secret name for Medusa PostgreSQL credentials.
*/}}
{{- define "ecommerce-store.medusa.postgresqlSecretName" -}}
{{- printf "%s-medusa-pg-secret" (include "ecommerce-store.fullname" .) }}
{{- end }}

{{/*
Generate the Medusa PostgreSQL service hostname.
*/}}
{{- define "ecommerce-store.medusa.postgresqlServiceName" -}}
{{- printf "%s-medusa-db" (include "ecommerce-store.fullname" .) }}
{{- end }}
