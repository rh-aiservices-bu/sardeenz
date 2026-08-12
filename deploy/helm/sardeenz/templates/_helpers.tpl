{{/*
Expand the name of the chart.
*/}}
{{- define "sardeenz.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name.
*/}}
{{- define "sardeenz.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart name and version label.
*/}}
{{- define "sardeenz.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "sardeenz.labels" -}}
helm.sh/chart: {{ include "sardeenz.chart" . }}
{{ include "sardeenz.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/component: ml-platform
app.kubernetes.io/part-of: sardeenz
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels. Includes the legacy `app` key because in-cluster peer
discovery and the headless service select on app=<name>.
*/}}
{{- define "sardeenz.selectorLabels" -}}
app: {{ include "sardeenz.name" . }}
app.kubernetes.io/name: {{ include "sardeenz.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
ServiceAccount name.
*/}}
{{- define "sardeenz.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sardeenz.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Name of the Secret to reference (existing or chart-managed).
*/}}
{{- define "sardeenz.secretName" -}}
{{- if .Values.secrets.existingSecret }}
{{- .Values.secrets.existingSecret }}
{{- else }}
{{- printf "%s-secrets" (include "sardeenz.fullname" .) }}
{{- end }}
{{- end }}

{{/*
ConfigMap name.
*/}}
{{- define "sardeenz.configMapName" -}}
{{- printf "%s-config" (include "sardeenz.fullname" .) }}
{{- end }}

{{/*
Headless service name (StatefulSet pod DNS).
*/}}
{{- define "sardeenz.headlessServiceName" -}}
{{- printf "%s-headless" (include "sardeenz.fullname" .) }}
{{- end }}

{{/*
Bundled PostgreSQL service name.
*/}}
{{- define "sardeenz.postgresqlName" -}}
{{- printf "%s-postgresql" (include "sardeenz.fullname" .) }}
{{- end }}
