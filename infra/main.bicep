@description('xT-WhatIf Azure Infrastructure as Code - Azure Container Apps (ACA) & Registry')

@description('Deployment region for all resources')
param location string = resourceGroup().location

@description('Unique environment prefix for resource naming')
param environmentName string = 'xtwhatif-prod'

@description('Optional internal URL for AKS distributed computation worker')
param aksWorkerUrl string = ''

@description('Azure OpenAI API Endpoint')
param azureOpenAiEndpoint string = 'https://xtwhatif-openai.openai.azure.com/'

@description('Azure OpenAI API Key')
@secure()
param azureOpenAiKey string = 'mock-azure-openai-key'

var acrName = replace(toLower('${environmentName}acr'), '-', '')

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
    adminUserEnabled: true
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

// ============================================================================
// 3. Azure Container App: xt-whatif-aca-gateway (Backend Gateway)
// ============================================================================
resource gatewayApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'xt-whatif-aca-gateway'
  location: location
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto' // Native WebSocket and HTTP/2 support
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          username: containerRegistry.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: containerRegistry.listCredentials().passwords[0].value
        }
        {
          name: 'openai-api-key'
          value: azureOpenAiKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'aca-gateway'
          image: '${containerRegistry.properties.loginServer}/xt-whatif-backend:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'SERVICE_ROLE'
              value: 'aca-gateway'
            }
            {
              name: 'AKS_WORKER_URL'
              value: aksWorkerUrl
            }
            {
              name: 'ENVIRONMENT'
              value: 'production'
            }
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
              name: 'BACKEND_CORS_ORIGINS'
              value: '["*"]'
            }
          ]
          probes: [
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

// ============================================================================
// 4. Azure Container App: xt-whatif-frontend (Next.js 15 App Router)
// ============================================================================
resource frontendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: 'xt-whatif-frontend'
  location: location
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
        allowInsecure: false
      }
      registries: [
        {
          server: containerRegistry.properties.loginServer
          username: containerRegistry.listCredentials().username
          passwordSecretRef: 'acr-password'
        }
      ]
      secrets: [
        {
          name: 'acr-password'
          value: containerRegistry.listCredentials().passwords[0].value
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: '${containerRegistry.properties.loginServer}/xt-whatif-frontend:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'NEXT_PUBLIC_API_URL'
              value: 'https://${gatewayApp.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'NEXT_PUBLIC_WS_URL'
              value: 'wss://${gatewayApp.properties.configuration.ingress.fqdn}'
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
output frontendUrl string = 'https://${frontendApp.properties.configuration.ingress.fqdn}'
output gatewayFqdn string = gatewayApp.properties.configuration.ingress.fqdn
output frontendFqdn string = frontendApp.properties.configuration.ingress.fqdn
