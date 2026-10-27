// xT-WhatIf Azure Infrastructure as Code - Azure Container Apps (ACA) & Registry

@description('Deployment region for all resources')
param location string = resourceGroup().location

@description('Unique environment prefix for resource naming')
param environmentName string = 'xtwhatif-prod'

@description('Image tag to deploy (the commit SHA from CI, so every deploy creates a new revision)')
param imageTag string = 'latest'

@description('Optional URL for AKS distributed computation worker')
param aksWorkerUrl string = ''

@description('Shared token for authenticating requests to the AKS worker')
@secure()
param aksWorkerToken string = ''

@description('Simulated fans on the live leaderboard (real load comes from backend/scripts/live_load_test.py)')
param liveBots int = 200

@description('Real seconds the 90 minutes of the live match last')
param liveMatchDurationSeconds int = 300

@description('Azure OpenAI API Endpoint')
param azureOpenAiEndpoint string = 'https://xtwhatif-openai.openai.azure.com/'

@description('Azure OpenAI API Key')
@secure()
param azureOpenAiKey string = ''

@description('Azure OpenAI Deployment for Text-To-Speech (TTS)')
param azureOpenAiTtsDeployment string = 'gpt-4o-mini-tts'

@description('Azure OpenAI API Version for Text-To-Speech (TTS)')
param azureOpenAiTtsApiVersion string = '2025-03-01-preview'

@description('Azure Container Registry Name')
param acrName string = replace(toLower('${environmentName}acr'), '-', '')

@description('Whether to create the AcrPull and Monitoring Reader role assignments in Bicep (requires Role Based Access Control Administrator or Owner permissions on the deployer)')
param createRoleAssignment bool = true
var backendImage = '${containerRegistry.properties.loginServer}/xt-whatif-backend:${imageTag}'
var frontendImage = '${containerRegistry.properties.loginServer}/xt-whatif-frontend:${imageTag}'

// Every app's public address is <name>.<environment default domain>, known before the apps
// exist: the URLs below need no dependency between apps.
var defaultDomain = appEnvironment.properties.defaultDomain
var gatewayFqdn = 'xt-whatif-aca-gateway.${defaultDomain}'
var liveFqdn = 'xt-whatif-live.${defaultDomain}'
var frontendFqdn = 'xt-whatif-frontend.${defaultDomain}'
// Only the frontend may call the APIs from a browser.
var corsOrigins = '["https://${frontendFqdn}"]'

// ============================================================================
// 1. Azure Container Registry (ACR)
// ============================================================================
resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

// ============================================================================
// 2. Managed Identity & Role Assignment for ACR Image Pull
// ============================================================================
resource containerAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${environmentName}-identity'
  location: location
}

// Built-in AcrPull role definition ID: 7f951dda-4ed3-4680-a7ca-43fe172d538d
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPullRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createRoleAssignment) {
  name: guid(containerRegistry.id, containerAppIdentity.id, acrPullRoleDefinitionId)
  scope: containerRegistry
  properties: {
    roleDefinitionId: acrPullRoleDefinitionId
    principalId: containerAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// 2. Log Analytics Workspace & Container Apps Managed Environment
// ============================================================================
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${environmentName}-logs'
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = {
  name: '${environmentName}-env'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Shared by both backend apps.
var registries = [
  {
    server: containerRegistry.properties.loginServer
    identity: containerAppIdentity.id
  }
]
var backendSecrets = [
  {
    name: 'openai-api-key'
    // Container Apps rejects secrets with an empty value: fall back to a placeholder.
    value: empty(azureOpenAiKey) ? 'mock-azure-openai-key' : azureOpenAiKey
  }
  {
    name: 'aks-worker-token'
    value: empty(aksWorkerToken) ? 'disabled-worker-token' : aksWorkerToken
  }
]
var openAiEnv = [
  {
    name: 'AZURE_OPENAI_API_KEY'
    secretRef: 'openai-api-key'
  }
  {
    name: 'AZURE_OPENAI_ENDPOINT'
    value: azureOpenAiEndpoint
  }
  {
    name: 'AZURE_OPENAI_API_VERSION'
    value: '2024-10-21'
  }
  {
    name: 'AZURE_OPENAI_DEPLOYMENT_GPT4O'
    value: 'gpt-4o'
  }
  {
    name: 'AZURE_OPENAI_DEPLOYMENT_MINI'
    value: 'gpt-4o-mini'
  }
  {
    name: 'AZURE_OPENAI_TTS_DEPLOYMENT'
    value: azureOpenAiTtsDeployment
  }
  {
    name: 'AZURE_OPENAI_TTS_API_VERSION'
    value: azureOpenAiTtsApiVersion
  }
]
var healthProbes = [
  {
    type: 'Liveness'
    httpGet: {
      path: '/health'
      port: 8000
    }
    initialDelaySeconds: 15
    periodSeconds: 20
  }
  {
    type: 'Readiness'
    httpGet: {
      path: '/health'
      port: 8000
    }
    initialDelaySeconds: 5
    periodSeconds: 10
  }
]

// ============================================================================
// 3. Azure Container App: xt-whatif-aca-gateway (stateless API, scales with KEDA)
// ============================================================================
resource gatewayApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'xt-whatif-aca-gateway'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${containerAppIdentity.id}': {}
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto' // Native WebSocket and HTTP/2 support
        allowInsecure: false
      }
      registries: registries
      secrets: backendSecrets
    }
    template: {
      containers: [
        {
          name: 'aca-gateway'
          image: backendImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat([
            {
              name: 'SERVICE_ROLE'
              value: 'aca-gateway'
            }
            {
              // The live match runs in xt-whatif-live only: replicas here must never start one.
              name: 'LIVE_ENABLED'
              value: 'false'
            }
            {
              name: 'AKS_WORKER_URL'
              value: aksWorkerUrl
            }
            {
              name: 'AKS_WORKER_TOKEN'
              secretRef: 'aks-worker-token'
            }
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'BACKEND_CORS_ORIGINS'
              value: corsOrigins
            }
            // The telemetry endpoint reads this app's ReplicaCount metric from Azure Monitor
            // (backend/app/services/cloud_telemetry.py) with the managed identity.
            {
              name: 'AZURE_SUBSCRIPTION_ID'
              value: subscription().subscriptionId
            }
            {
              name: 'AZURE_RESOURCE_GROUP'
              value: resourceGroup().name
            }
            {
              name: 'ACA_GATEWAY_NAME'
              value: 'xt-whatif-aca-gateway'
            }
            {
              // A user-assigned identity must be named for DefaultAzureCredential to use it.
              name: 'AZURE_CLIENT_ID'
              value: containerAppIdentity.properties.clientId
            }
          ], openAiEnv)
          probes: healthProbes
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 10
        rules: [
          {
            name: 'keda-http-concurrency-rule'
            http: {
              metadata: {
                concurrentRequests: '20'
              }
            }
          }
        ]
      }
    }
  }
}

// Built-in Monitoring Reader role definition ID: 43d0d8ad-25c7-4714-9337-8ba259a9fe05
var monitoringReaderRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '43d0d8ad-25c7-4714-9337-8ba259a9fe05')

// Lets the gateway read its own replica count. Until the role propagates (a few minutes after
// the first deploy) the telemetry endpoint keeps returning estimated figures.
resource gatewayMonitoringReaderRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (createRoleAssignment) {
  name: guid(gatewayApp.id, containerAppIdentity.id, monitoringReaderRoleDefinitionId)
  scope: gatewayApp
  properties: {
    roleDefinitionId: monitoringReaderRoleDefinitionId
    principalId: containerAppIdentity.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

// ============================================================================
// 4. Azure Container App: xt-whatif-live (the one live match: exactly one replica)
// ============================================================================
// Every fan must see the same match and the same key moment, so the match room lives in
// a single replica. It serves /ws/live and the preview of live moments, and offloads
// moment Validator searches to the AKS worker pool when AKS_WORKER_URL is set.
resource liveApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'xt-whatif-live'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${containerAppIdentity.id}': {}
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registries
      secrets: backendSecrets
    }
    template: {
      containers: [
        {
          name: 'live-match'
          image: backendImage
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: concat([
            {
              name: 'SERVICE_ROLE'
              value: 'live'
            }
            {
              name: 'LIVE_ENABLED'
              value: 'true'
            }
            {
              name: 'LIVE_BOTS'
              value: string(liveBots)
            }
            {
              name: 'LIVE_MATCH_DURATION_S'
              value: string(liveMatchDurationSeconds)
            }
            {
              name: 'AKS_WORKER_URL'
              value: aksWorkerUrl
            }
            {
              name: 'AKS_WORKER_TOKEN'
              secretRef: 'aks-worker-token'
            }
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
            {
              name: 'BACKEND_CORS_ORIGINS'
              value: corsOrigins
            }
          ], openAiEnv)
          probes: healthProbes
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// ============================================================================
// 5. Azure Container App: xt-whatif-frontend (Next.js 15 App Router)
// ============================================================================
resource frontendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'xt-whatif-frontend'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${containerAppIdentity.id}': {}
    }
  }
  dependsOn: [
    acrPullRoleAssignment
  ]
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: frontendImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          // Read by the root layout on every request (frontend/src/lib/api.ts).
          env: [
            {
              name: 'API_URL'
              value: 'https://${gatewayFqdn}'
            }
            {
              name: 'WS_URL'
              value: 'wss://${gatewayFqdn}'
            }
            {
              name: 'LIVE_API_URL'
              value: 'https://${liveFqdn}'
            }
            {
              name: 'LIVE_WS_URL'
              value: 'wss://${liveFqdn}'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 5
      }
    }
  }
}

// ============================================================================
// Outputs
// ============================================================================
output acrLoginServer string = containerRegistry.properties.loginServer
output gatewayUrl string = 'https://${gatewayApp.properties.configuration.ingress.fqdn}'
output liveUrl string = 'https://${liveApp.properties.configuration.ingress.fqdn}'
output frontendUrl string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output gatewayFqdn string = gatewayApp.properties.configuration.ingress.fqdn
output liveFqdn string = liveApp.properties.configuration.ingress.fqdn
output frontendFqdn string = frontendApp.properties.configuration.ingress.fqdn
output managedIdentityId string = containerAppIdentity.id
output managedIdentityClientId string = containerAppIdentity.properties.clientId
