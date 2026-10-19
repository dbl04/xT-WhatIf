@description('PitchGhost-360 / xT-WhatIf Azure Infrastructure as Code (ACA + Redis + Azure OpenAI)')

@description('Deployment location')
param location string = resourceGroup().location

@description('Environment name prefix')
param environmentName string = 'pitchghost-prod'

@description('Azure OpenAI pricing tier')
param openAiSku string = 'S0'

@description('Redis Cache SKU')
param redisSkuFamily string = 'C'
param redisSkuName string = 'Basic'
param redisSkuCapacity int = 0

// ----------------------------------------------------------------------------
// 1. Azure Container Registry (ACR)
// ----------------------------------------------------------------------------
resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: replace('${environmentName}acr', '-', '')
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

// ----------------------------------------------------------------------------
// 2. Azure Cache for Redis
// ----------------------------------------------------------------------------
resource redisCache 'Microsoft.Cache/redis@2023-08-01' = {
  name: '${environmentName}-redis'
  location: location
  properties: {
    sku: {
      name: redisSkuName
      family: redisSkuFamily
      capacity: redisSkuCapacity
    }
    enableNonSslPort: false
    minimumTlsVersion: '1.2'
  }
}

// ----------------------------------------------------------------------------
// 3. Azure OpenAI Service (Agent Swarm)
// ----------------------------------------------------------------------------
resource openAiAccount 'Microsoft.CognitiveServices/accounts@2023-05-01' = {
  name: '${environmentName}-openai'
  location: location
  kind: 'OpenAI'
  sku: {
    name: openAiSku
  }
  properties: {
    customSubDomainName: '${environmentName}-openai'
    publicNetworkAccess: 'Enabled'
  }
}

// Deploy GPT-4o for Data Scientist Reasoning
resource gpt4oDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: 'gpt-4o'
  sku: {
    name: 'Standard'
    capacity: 20
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o'
      version: '2024-05-13'
    }
  }
}

// Deploy GPT-4o-mini for Coach Fast Responses
resource gpt4oMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2023-05-01' = {
  parent: openAiAccount
  name: 'gpt-4o-mini'
  sku: {
    name: 'Standard'
    capacity: 30
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
  }
  dependsOn: [
    gpt4oDeployment
  ]
}

// ----------------------------------------------------------------------------
// 4. Azure Container Apps Environment
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// 5. FastAPI Backend Container App
// ----------------------------------------------------------------------------
resource backendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: '${environmentName}-backend'
  location: location
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        transport: 'auto'
      }
      secrets: [
        {
          name: 'openai-key'
          value: openAiAccount.listKeys().key1
        }
        {
          name: 'redis-password'
          value: redisCache.listKeys().primaryKey
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: '${containerRegistry.properties.loginServer}/pitchghost-backend:latest'
          resources: {
            cpu: json('1.0')
            memory: '2Gi'
          }
          env: [
            {
              name: 'AZURE_OPENAI_API_KEY'
              secretRef: 'openai-key'
            }
            {
              name: 'AZURE_OPENAI_ENDPOINT'
              value: openAiAccount.properties.endpoint
            }
            {
              name: 'REDIS_URL'
              value: 'rediss://:${redisCache.listKeys().primaryKey}@${redisCache.properties.hostName}:${redisCache.properties.sslPort}/0'
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

// ----------------------------------------------------------------------------
// 6. Next.js 15 Frontend Container App
// ----------------------------------------------------------------------------
resource frontendApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: '${environmentName}-frontend'
  location: location
  properties: {
    managedEnvironmentId: appEnvironment.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: '${containerRegistry.properties.loginServer}/pitchghost-frontend:latest'
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'NEXT_PUBLIC_API_URL'
              value: 'https://${backendApp.properties.configuration.ingress.fqdn}'
            }
            {
              name: 'NEXT_PUBLIC_WS_URL'
              value: 'wss://${backendApp.properties.configuration.ingress.fqdn}/ws'
            }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
}

output acrLoginServer string = containerRegistry.properties.loginServer
output backendFqdn string = backendApp.properties.configuration.ingress.fqdn
output frontendFqdn string = frontendApp.properties.configuration.ingress.fqdn
output openAiEndpoint string = openAiAccount.properties.endpoint
