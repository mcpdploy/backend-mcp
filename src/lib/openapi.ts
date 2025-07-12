export const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'MCP Multi-Tenant API',
    version: '1.0.0',
    description: 'API for managing MCP projects, resources, tools, and prompts.'
  },
  servers: [
    { url: 'http://localhost:3000/', description: 'Local development' },
    { url: 'https://api.mcpdploy.com/', description: 'Production' },
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication and account management endpoints'
    },
    {
      name: 'Projects',
      description: 'MCP project management and configuration endpoints'
    },
    {
      name: 'Analytics',
      description: 'Usage analytics and reporting endpoints'
    },
    {
      name: 'Subscriptions',
      description: 'User subscription and plan management endpoints'
    },
    {
      name: 'Payments',
      description: 'Stripe payment processing endpoints'
    },
    {
      name: 'Support',
      description: 'Customer support and ticket management endpoints'
    },
    {
      name: 'Public',
      description: 'Public endpoints that do not require authentication'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    },
    schemas: {
      BaseResource: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, example: 'My Resource' },
          uri: { type: 'string', minLength: 1, example: 'resource://data/config.json', description: 'URI for the resource. Use proper URI schemes like resource://, file://, http://, etc.' },
          resource_type: { 
            type: 'string', 
            enum: ['static', 'dynamic', 'context_aware'], 
            default: 'static',
            description: 'Type of resource: static (fixed URI), dynamic (parameterized URI), or context_aware (with completion)'
          },
          parameters: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              properties: {
                description: { type: 'string' },
                type: { type: 'string' },
                required: { type: 'boolean' }
              }
            },
            example: { 
              userId: { 
                description: 'The user ID', 
                type: 'string', 
                required: true 
              } 
            },
            description: 'Parameter definitions for dynamic resources'
          },
          completion_config: {
            type: 'object',
            description: 'Completion configuration for context-aware resources. Define completion strategies for template parameters.',
            properties: {
              complete: {
                type: 'object',
                description: 'Map of parameter names to completion configurations',
                additionalProperties: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['static'], description: 'Static list of completions' },
                        values: { type: 'array', items: { type: 'string' }, description: 'List of possible values' }
                      },
                      required: ['type', 'values']
                    },
                    {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['conditional'], description: 'Conditional completions based on other parameters' },
                        conditions: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              when: { type: 'object', description: 'Conditions that must match (parameter: value pairs)' },
                              values: { type: 'array', items: { type: 'string' }, description: 'Values to return when conditions match' }
                            },
                            required: ['when', 'values']
                          }
                        },
                        default: { type: 'array', items: { type: 'string' }, description: 'Default values if no conditions match' }
                      },
                      required: ['type', 'conditions']
                    }
                  ]
                }
              }
            },
            example: {
              complete: {
                repo: {
                  type: 'conditional',
                  conditions: [
                    {
                      when: { owner: 'org1' },
                      values: ['project1', 'project2', 'project3']
                    },
                    {
                      when: { owner: 'org2' },
                      values: ['app1', 'app2', 'app3']
                    }
                  ],
                  default: ['default-repo']
                }
              }
            }
          },
          static_content: { 
            type: 'string', 
            example: 'This is static content for the resource',
            description: 'Static content to return when no api_url is provided'
          },
          mime_type: { 
            type: 'string', 
            default: 'application/json',
            example: 'text/plain',
            description: 'MIME type of the resource content'
          },
          title: { 
            type: 'string', 
            example: 'Application Configuration',
            description: 'Human-readable title for the resource'
          },
          description: { 
            type: 'string', 
            example: 'Application configuration data',
            description: 'Description of what the resource provides'
          },
          api_url: { type: 'string', format: 'url', example: 'https://api.example.com/resource_proxy', nullable: true },
          headers: { type: 'object', additionalProperties: { type: 'string' }, example: { 'X-API-KEY': 'mysecretkey' }, nullable: true }
        },
        required: ['name', 'uri']
      },
      BaseTool: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, example: 'calculate-bmi' },
          title: { type: 'string', example: 'BMI Calculator', nullable: true },
          description: { type: 'string', example: 'Calculate Body Mass Index', nullable: true },
          tool_type: { 
            type: 'string', 
            enum: ['static', 'api', 'resource_link'],
            default: 'static',
            nullable: true,
            description: 'Type of tool: static (simple calculations), api (external API calls), or resource_link (returns resource links)'
          },
          parameters: { 
            type: 'object', 
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
                    description: { type: 'string' },
                    required: { type: 'boolean', default: true },
                    default: { }
                  }
                }
              ]
            },
            example: { 
              city: { type: 'string', description: 'City name', required: true }
            }, 
            nullable: true 
          },
          static_result: { 
            type: 'string', 
            example: 'BMI: {weightKg} / ({heightM} * {heightM}) = calculated value', 
            nullable: true, 
            description: 'Static result template for simple tools. Use {paramName} to reference parameters.' 
          },
          api_url: { 
            type: 'string', 
            format: 'url', 
            example: 'https://wttr.in/{city}?format=j1', 
            nullable: true, 
            description: 'API endpoint for async tools. Parameters in URL path (e.g., {city}) are replaced with actual values.' 
          },
          headers: { type: 'object', additionalProperties: { type: 'string' }, example: { 'Accept': 'application/json' }, nullable: true },
          http_method: { type: 'string', enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET", nullable: true },
          resource_links: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                uri: { type: 'string', example: 'file:///project/README.md' },
                name: { type: 'string', example: 'README.md' },
                mimeType: { type: 'string', example: 'text/markdown' },
                description: { type: 'string', example: 'A README file' }
              },
              required: ['uri', 'name']
            },
            nullable: true,
            description: 'Static resource links for tools that return file/resource references'
          },
          resource_links_header: { 
            type: 'string', 
            example: 'Found files matching "{pattern}":', 
            nullable: true,
            description: 'Optional header text for resource links. Use {paramName} to reference parameters.'
          }
        },
        required: ['name']
      },
      BasePrompt: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, example: 'review-code' },
          title: { type: 'string', example: 'Code Review', nullable: true },
          description: { type: 'string', example: 'Review code for best practices and potential issues', nullable: true },
          prompt_type: { 
            type: 'string', 
            enum: ['basic', 'context_aware'], 
            default: 'basic', 
            example: 'basic', 
            nullable: true,
            description: 'Type of prompt: basic (simple template) or context_aware (with completion configuration)'
          },
          template: { type: 'string', minLength: 1, example: 'Please review this code:\n\n{{code}}' },
          role: { type: 'string', enum: ['user', 'assistant'], default: 'user', example: 'user', nullable: true },
          arguments: { 
            type: 'object',
            description: 'MCP-compliant prompt arguments (preferred over parameters)',
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
                    description: { type: 'string' },
                    required: { type: 'boolean', default: true },
                    default: { }
                  }
                }
              ]
            },
            example: { 
              code: { type: 'string', description: 'The code to review', required: true }
            }, 
            nullable: true 
          },
          parameters: { 
            type: 'object',
            description: 'Legacy field for backward compatibility. Use arguments instead for MCP compliance.',
            additionalProperties: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    type: { type: 'string', enum: ['string', 'number', 'boolean', 'array', 'object'] },
                    description: { type: 'string' },
                    required: { type: 'boolean', default: true },
                    default: { }
                  }
                }
              ]
            },
            example: { 
              code: { type: 'string', description: 'The code to review', required: true }
            }, 
            nullable: true 
          },
          completion_config: {
            type: 'object',
            description: 'Completion configuration for context-aware prompts. Define completion strategies for template parameters.',
            properties: {
              complete: {
                type: 'object',
                description: 'Map of parameter names to completion configurations',
                additionalProperties: {
                  oneOf: [
                    {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['static'], description: 'Static list of completions' },
                        values: { type: 'array', items: { type: 'string' }, description: 'List of possible values' }
                      },
                      required: ['type', 'values']
                    },
                    {
                      type: 'object',
                      properties: {
                        type: { type: 'string', enum: ['conditional'], description: 'Conditional completions based on other parameters' },
                        conditions: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              when: { type: 'object', description: 'Conditions that must match (parameter: value pairs)' },
                              values: { type: 'array', items: { type: 'string' }, description: 'Values to return when conditions match' }
                            },
                            required: ['when', 'values']
                          }
                        },
                        default: { type: 'array', items: { type: 'string' }, description: 'Default values if no conditions match' }
                      },
                      required: ['type', 'conditions']
                    }
                  ]
                }
              }
            },
            nullable: true,
            example: {
              complete: {
                department: {
                  type: 'static',
                  values: ['engineering', 'sales', 'marketing', 'support']
                },
                name: {
                  type: 'conditional',
                  conditions: [
                    {
                      when: { department: 'engineering' },
                      values: ['Alice', 'Bob', 'Charlie']
                    }
                  ],
                  default: ['Guest']
                }
              }
            }
          }
        },
        required: ['name', 'template']
      },
      ProjectSubResource: {
        allOf: [
          { $ref: '#/components/schemas/BaseResource' },
          { type: 'object', properties: { id: { type: 'string', format: 'uuid', nullable: true } } }
        ]
      },
      ProjectSubTool: {
        allOf: [
          { $ref: '#/components/schemas/BaseTool' },
          { type: 'object', properties: { id: { type: 'string', format: 'uuid', nullable: true } } }
        ]
      },
      ProjectSubPrompt: {
        allOf: [
          { $ref: '#/components/schemas/BasePrompt' },
          { type: 'object', properties: { id: { type: 'string', format: 'uuid', nullable: true } } }
        ]
      },
      McpProject: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid', readOnly: true, example: '00000000-0000-0000-0000-000000000000' },
          name: { type: 'string', example: 'My Awesome Project' },
          description: { type: 'string', example: 'A truly awesome project.', nullable: true },
          version: { type: 'string', example: '1.0.1', nullable: true },
          is_private: { type: 'boolean', example: false },
          visible: { type: 'boolean', example: false, description: 'Whether this project is visible in public listings' },
          session_management: { type: 'boolean', example: false, description: 'Enable stateful session management' },
          tags: { type: 'array', items: { type: 'string' }, example: ['AI', 'Automation', 'API'], nullable: true, description: 'Tags for categorizing and organizing projects' },
          category: { type: 'string', example: 'Development', nullable: true, description: 'Main category or domain of the project' },
          api_key: { type: 'string', readOnly: true, example: 'xxxx-xxxx-xxxx-xxxx' },
          endpoint: { type: 'string', format: 'url', readOnly: true, example: 'http://localhost:3000/mcp/my-awesome-project-00000000' },
          is_active: { type: 'boolean', default: true },
          user_id: { type: 'string', format: 'uuid', readOnly: true },
          created_at: { type: 'string', format: 'date-time', readOnly: true },
          updated_at: { type: 'string', format: 'date-time', readOnly: true },
          mcp_resources: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubResource' }, nullable: true },
          mcp_tools: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubTool' }, nullable: true },
          mcp_prompts: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubPrompt' }, nullable: true }
        },
        required: ['id', 'name', 'api_key', 'endpoint', 'is_active', 'user_id', 'created_at', 'updated_at']
      }
    }
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/mcp-projects': {
      get: {
        tags: ['Projects'],
        summary: 'List all MCP projects for the authenticated user',
        responses: {
          '200': {
            description: 'A list of MCP projects',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'object' } }
              }
            }
          },
          '401': { description: 'Unauthorized' }
        }
      },
      post: {
        tags: ['Projects'],
        summary: 'Create a new MCP project',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'My MCP Project' },
                  description: { type: 'string', example: 'A description of the project.', nullable: true },
                  version: { type: 'string', example: '1.0.0', nullable: true },
                  is_private: { type: 'boolean', example: false },
                  visible: { type: 'boolean', example: false, description: 'Whether this project is visible in public listings' },
                  session_management: { type: 'boolean', example: false, description: 'Enable stateful session management' },
                  tags: { type: 'array', items: { type: 'string' }, example: ['AI', 'Automation', 'API'], nullable: true, description: 'Tags for categorizing and organizing projects' },
                  category: { type: 'string', example: 'Development', nullable: true, description: 'Main category or domain of the project' },
                  resources: { type: 'array', items: { $ref: '#/components/schemas/BaseResource' }, nullable: true },
                  tools: { type: 'array', items: { $ref: '#/components/schemas/BaseTool' }, nullable: true },
                  prompts: { type: 'array', items: { $ref: '#/components/schemas/BasePrompt' }, nullable: true }
                },
                required: ['name']
              },
              example: {
                name: 'My Test Project',
                description: 'A project for testing.',
                version: '0.1.0',
                is_private: false,
                visible: true,
                session_management: false,
                tags: ['AI', 'Automation', 'API'],
                category: 'Development',
                resources: [
                  { 
                    name: 'Config File', 
                    resource_type: 'static',
                    uri: 'resource://config.json', 
                    title: 'Application Configuration',
                    description: 'Main configuration file with static content',
                    mime_type: 'application/json',
                    static_content: '{"version": "1.0", "features": {"auth": true, "api": true}}' 
                  },
                  {
                    name: 'Bitcoin Price',
                    resource_type: 'static',
                    uri: 'resource://crypto/btc-price',
                    title: 'Current Bitcoin Price',
                    description: 'Fetches current Bitcoin price from CoinGecko API',
                    mime_type: 'application/json',
                    api_url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
                    headers: { 'Accept': 'application/json' }
                  },
                  {
                    name: 'User Profile',
                    resource_type: 'dynamic',
                    uri: 'github://users/{username}',
                    title: 'GitHub User Profile',
                    description: 'Fetches GitHub user profile information',
                    parameters: {
                      username: {
                        description: 'GitHub username',
                        type: 'string',
                        required: true
                      }
                    },
                    api_url: 'https://api.github.com/users/{username}',
                    headers: { 
                      'Accept': 'application/vnd.github.v3+json',
                      'User-Agent': 'MCP-Server'
                    }
                  },
                  {
                    name: 'Weather Data',
                    resource_type: 'dynamic',
                    uri: 'weather://{city}',
                    title: 'City Weather Information',
                    description: 'Current weather data for a city',
                    parameters: {
                      city: {
                        description: 'City name (e.g., London, New York)',
                        type: 'string',
                        required: true
                      }
                    },
                    api_url: 'https://wttr.in/{city}?format=j1',
                    headers: { 'Accept': 'application/json' }
                  },
                  {
                    name: 'repository',
                    resource_type: 'context_aware',
                    uri: 'github://repos/{owner}/{repo}',
                    title: 'GitHub Repository',
                    description: 'Repository information',
                    parameters: {
                      owner: {
                        description: 'Repository owner',
                        type: 'string',
                        required: true
                      },
                      repo: {
                        description: 'Repository name',
                        type: 'string',
                        required: true
                      }
                    },
                    completion_config: {
                      complete: {
                        repo: {
                          type: 'conditional',
                          conditions: [
                            {
                              when: { owner: 'org1' },
                              values: ['project1', 'project2', 'project3']
                            },
                            {
                              when: { owner: 'microsoft' },
                              values: ['vscode', 'typescript', 'playwright', 'terminal']
                            },
                            {
                              when: { owner: 'facebook' },
                              values: ['react', 'react-native', 'jest', 'flow']
                            }
                          ],
                          default: ['default-repo', 'sample-repo']
                        }
                      }
                    },
                    static_content: 'Repository: {owner}/{repo}'
                  }
                ],
                tools: [
                  {
                    name: 'calculate-bmi',
                    title: 'BMI Calculator',
                    description: 'Calculate Body Mass Index from weight and height',
                    tool_type: 'static',
                    parameters: {
                      weightKg: { type: 'number', description: 'Weight in kilograms', required: true },
                      heightM: { type: 'number', description: 'Height in meters', required: true }
                    },
                    static_result: 'BMI calculation: {weightKg} / ({heightM} * {heightM}) = result'
                  },
                  {
                    name: 'fetch-weather',
                    title: 'Weather Fetcher',
                    description: 'Get current weather data for a city',
                    tool_type: 'api',
                    parameters: {
                      city: { type: 'string', description: 'City name (e.g., London, Seattle)', required: true }
                    },
                    api_url: 'https://wttr.in/{city}?format=j1',
                    http_method: 'GET',
                    headers: { 'Accept': 'application/json' }
                  },
                  {
                    name: 'get-crypto-price',
                    title: 'Crypto Price Fetcher',
                    description: 'Get current cryptocurrency price',
                    tool_type: 'api',
                    parameters: {
                      symbol: { type: 'string', description: 'Crypto symbol (e.g., bitcoin, ethereum)', required: true },
                      currency: { type: 'string', description: 'Currency (e.g., usd, eur)', required: true }
                    },
                    api_url: 'https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies={currency}',
                    http_method: 'GET',
                    headers: { 'Accept': 'application/json' }
                  },
                  {
                    name: 'list-files',
                    title: 'List Project Files',
                    description: 'Returns a list of project files matching a pattern',
                    tool_type: 'resource_link',
                    parameters: {
                      pattern: { type: 'string', description: 'File pattern to match (e.g., *.ts, README*)', required: true }
                    },
                    resource_links_header: 'Found files matching "{pattern}":',
                    resource_links: [
                      {
                        uri: 'file:///project/README.md',
                        name: 'README.md',
                        mimeType: 'text/markdown',
                        description: 'Project documentation'
                      },
                      {
                        uri: 'file:///project/src/index.ts',
                        name: 'index.ts',
                        mimeType: 'text/typescript',
                        description: 'Main application entry point'
                      },
                      {
                        uri: 'file:///project/package.json',
                        name: 'package.json',
                        mimeType: 'application/json',
                        description: 'Package configuration'
                      }
                    ]
                  }
                ],
                prompts: [
                  {
                    name: 'review-code',
                    title: 'Code Review',
                    description: 'Review code for best practices and potential issues',
                    prompt_type: 'basic',
                    template: 'Please review this code:\n\n{{code}}',
                    role: 'user',
                    arguments: {
                      code: { type: 'string', description: 'The code to review', required: true }
                    }
                  },
                  {
                    name: 'team-greeting',
                    title: 'Team Greeting',
                    description: 'Generate a greeting for team members with context-aware name completion',
                    prompt_type: 'context_aware',
                    template: 'Hello {{name}}, welcome to the {{department}} team!',
                    role: 'assistant',
                    arguments: {
                      department: {
                        type: 'string',
                        description: 'Department name',
                        required: true
                      },
                      name: {
                        type: 'string',
                        description: 'Team member name',
                        required: true
                      }
                    },
                    completion_config: {
                      complete: {
                        department: {
                          type: 'static',
                          values: ['engineering', 'sales', 'marketing', 'support']
                        },
                        name: {
                          type: 'conditional',
                          conditions: [
                            {
                              when: { department: 'engineering' },
                              values: ['Alice', 'Bob', 'Charlie', 'Diana']
                            },
                            {
                              when: { department: 'sales' },
                              values: ['David', 'Eve', 'Frank', 'Grace']
                            },
                            {
                              when: { department: 'marketing' },
                              values: ['Henry', 'Iris', 'Jack', 'Kate']
                            },
                            {
                              when: { department: 'support' },
                              values: ['Liam', 'Mia', 'Noah', 'Olivia']
                            }
                          ],
                          default: ['Guest', 'Visitor']
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        responses: {
          '201': {
            description: 'Project created successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/McpProject' }
              }
            }
          },
          '400': { description: 'Invalid request payload' },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Internal Server Error' }
        }
      }
    },
    '/mcp-projects/{id}': {
      get: {
        tags: ['Projects'],
        summary: 'Get a specific MCP project',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': {
            description: 'Project details',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/McpProject' }
              }
            }
          },
          '404': { description: 'Not found' },
          '401': { description: 'Unauthorized' }
        }
      },
      put: {
        tags: ['Projects'],
        summary: 'Update an MCP project',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  name: { type: 'string', example: 'My Updated MCP Project', nullable: true },
                  description: { type: 'string', example: 'An updated description.', nullable: true },
                  version: { type: 'string', example: '1.0.1', nullable: true },
                  is_private: { type: 'boolean', example: false, nullable: true },
                  visible: { type: 'boolean', example: true, nullable: true, description: 'Whether this project is visible in public listings' },
                  session_management: { type: 'boolean', example: true, nullable: true, description: 'Enable stateful session management' },
                  is_active: { type: 'boolean', example: true, nullable: true },
                  tags: { type: 'array', items: { type: 'string' }, example: ['AI', 'Automation', 'Updated'], nullable: true, description: 'Tags for categorizing and organizing projects' },
                  category: { type: 'string', example: 'Machine Learning', nullable: true, description: 'Main category or domain of the project' },
                  resources: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubResource' }, nullable: true },
                  tools: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubTool' }, nullable: true },
                  prompts: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubPrompt' }, nullable: true }
                }
              },
              example: {
                name: 'My Super Project - Updated',
                description: 'Now with more awesomeness and full sub-item management.',
                version: '1.1.0',
                is_private: false,
                visible: true,
                is_active: true,
                session_management: true,
                tags: ['AI', 'Machine Learning', 'Updated'],
                category: 'Machine Learning',
                resources: [
                  { 
                    id: 'existing-resource-uuid', 
                    name: 'Main Data Source', 
                    resource_type: 'static',
                    uri: 'resource://data/main.json', 
                    title: 'Main Data Configuration',
                    description: 'Primary data source for the application',
                    mime_type: 'application/json',
                    api_url: 'https://jsonplaceholder.typicode.com/posts/1', 
                    headers: { 'Accept': 'application/json' } 
                  },
                  { 
                    name: 'User Activity Feed', 
                    resource_type: 'dynamic',
                    uri: 'activity://posts/user/{userId}',
                    title: 'User Posts',
                    description: 'Fetches posts for a specific user',
                    parameters: {
                      userId: {
                        description: 'The user ID (1-10 for JSONPlaceholder)',
                        type: 'string',
                        required: true
                      }
                    },
                    api_url: 'https://jsonplaceholder.typicode.com/posts?userId={userId}', 
                    headers: { 'Accept': 'application/json' } 
                  }
                ],
                tools: [
                  { 
                    id: 'existing-tool-uuid', 
                    name: 'fetch-github-user', 
                    title: 'GitHub User Info',
                    description: 'Fetch GitHub user profile information',
                    parameters: {
                      username: { type: 'string', description: 'GitHub username', required: true }
                    },
                    api_url: 'https://api.github.com/users/{username}',
                    http_method: 'GET',
                    headers: { 
                      'Accept': 'application/vnd.github.v3+json',
                      'User-Agent': 'MCP-Server'
                    }
                  },
                  {
                    name: 'simple-greeting',
                    title: 'Simple Greeting',
                    description: 'Generate a personalized greeting',
                    parameters: {
                      name: { type: 'string', description: 'Person\'s name', required: true },
                      timeOfDay: { type: 'string', description: 'Time of day (morning, afternoon, evening)', required: false }
                    },
                    static_result: 'Good {timeOfDay}, {name}! Welcome to our MCP server.'
                  }
                ],
                prompts: [
                  {
                    id: 'existing-prompt-uuid',
                    name: 'code-explanation',
                    title: 'Code Explanation',
                    description: 'Explain what a piece of code does',
                    prompt_type: 'basic',
                    template: 'Please explain what this {{language}} code does:\n\n{{code}}',
                    role: 'user',
                    arguments: {
                      language: { type: 'string', description: 'Programming language', required: true },
                      code: { type: 'string', description: 'Code to explain', required: true }
                    }
                  },
                  {
                    name: 'team-greeting',
                    title: 'Team Greeting',
                    description: 'Generate a greeting for team members with context-aware name completion',
                    prompt_type: 'context_aware',
                    template: 'Hello {{name}}, welcome to the {{department}} team!',
                    role: 'assistant',
                    arguments: {
                      department: { type: 'string', description: 'Department name', required: true },
                      name: { type: 'string', description: 'Team member name', required: true }
                    },
                    completion_config: {
                      complete: {
                        department: {
                          type: 'static',
                          values: ['engineering', 'sales', 'marketing', 'support']
                        },
                        name: {
                          type: 'conditional',
                          conditions: [
                            {
                              when: { department: 'engineering' },
                              values: ['Alice', 'Bob', 'Charlie', 'Diana']
                            },
                            {
                              when: { department: 'sales' },
                              values: ['David', 'Eve', 'Frank', 'Grace']
                            },
                            {
                              when: { department: 'marketing' },
                              values: ['Henry', 'Iris', 'Jack', 'Kate']
                            },
                            {
                              when: { department: 'support' },
                              values: ['Liam', 'Maya', 'Noah', 'Olivia']
                            }
                          ],
                          default: ['Guest', 'Visitor']
                        }
                      }
                    }
                  }
                ]
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Project updated successfully',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/McpProject' }
              }
            }
          },
          '400': { description: 'Invalid request payload' },
          '404': { description: 'Not found' },
          '401': { description: 'Unauthorized' }
        }
      },
      delete: {
        tags: ['Projects'],
        summary: 'Delete an MCP project',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
        ],
        responses: {
          '200': { description: 'Project deleted' },
          '404': { description: 'Not found' },
          '401': { description: 'Unauthorized' }
        }
      }
    },
    '/public/mcp-projects': {
      get: {
        tags: ['Public'],
        summary: 'Get all visible MCP projects (public endpoint)',
        description: 'Returns all MCP projects that have visible=true. This is a public endpoint that does not require authentication.',
        security: [], // Override global security to make this endpoint public
        responses: {
          '200': {
            description: 'A list of visible MCP projects',
            content: {
              'application/json': {
                schema: { 
                  type: 'array', 
                  items: { 
                    type: 'object',
                    description: 'MCP Project (public view - basic information only)',
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string', nullable: true },
                      version: { type: 'string', nullable: true },
                      tags: { type: 'array', items: { type: 'string' }, nullable: true, description: 'Tags for categorizing and organizing projects' },
                      category: { type: 'string', nullable: true, description: 'Main category or domain of the project' },
                      endpoint: { type: 'string', format: 'url' },
                      created_at: { type: 'string', format: 'date-time' }
                    },
                    required: ['name', 'endpoint', 'created_at']
                  }
                },
                example: [
                  {
                    name: 'My Awesome Project',
                    description: 'A truly awesome project.',
                    version: '1.0.1',
                    tags: ['AI', 'Automation', 'API'],
                    category: 'Development',
                    endpoint: 'http://localhost:3000/mcp/my-awesome-project-00000000',
                    created_at: '2025-06-28T06:55:11.100Z'
                  },
                  {
                    name: 'Weather Service API',
                    description: 'Get weather information for any city',
                    version: '2.0.0',
                    tags: ['Weather', 'API', 'Data'],
                    category: 'Utilities',
                    endpoint: 'https://api.mcpdploy.com/mcp/weather-service-550e8400',
                    created_at: '2025-06-15T10:30:00Z'
                  },
                  {
                    name: 'File Manager Tool',
                    description: null,
                    version: null,
                    tags: null,
                    category: null,
                    endpoint: 'https://api.mcpdploy.com/mcp/file-manager-990e8400',
                    created_at: '2025-06-20T14:15:00Z'
                  }
                ]
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login with email and password (Supabase)',
        description: 'Returns a JWT access token on success. Use this token as a Bearer token for authenticated requests.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  password: { type: 'string', example: 'yourpassword' }
                },
                required: ['email', 'password']
              },
              example: {
                email: 'user@example.com',
                password: 'yourpassword'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Login successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: 'JWT access token' },
                    token_type: { type: 'string', example: 'bearer' },
                    expires_in: { type: 'integer', example: 3600 },
                    refresh_token: { type: 'string' },
                    user: { type: 'object' }
                  }
                },
                example: {
                  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                  token_type: 'bearer',
                  expires_in: 3600,
                  refresh_token: 'some-refresh-token',
                  user: { id: 'uuid', email: 'user@example.com' }
                }
              }
            }
          },
          '400': { description: 'Invalid credentials' }
        }
      }
    },
    '/auth/signup': {
      post: {
        tags: ['Authentication'],
        summary: 'Sign up with email and password (Supabase)',
        description: 'Creates a new user and returns a JWT access token on success.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { type: 'string', example: 'user@example.com' },
                  password: { 
                    type: 'string', 
                    example: 'MyP@ssw0rd!',
                    description: 'Password must be at least 8 characters long and contain at least one uppercase letter and one special character',
                    minLength: 8
                  },
                  name: { type: 'string', example: 'John Doe', description: 'Optional user name to store in metadata' }
                },
                required: ['email', 'password']
              },
              example: {
                email: 'user@example.com',
                password: 'MyP@ssw0rd!',
                name: 'John Doe'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Signup successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: 'JWT access token' },
                    token_type: { type: 'string', example: 'bearer' },
                    expires_in: { type: 'integer', example: 3600 },
                    refresh_token: { type: 'string' },
                    user: { type: 'object' }
                  }
                },
                example: {
                  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                  token_type: 'bearer',
                  expires_in: 3600,
                  refresh_token: 'some-refresh-token',
                  user: { id: 'uuid', email: 'user@example.com' }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid signup data or password validation failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { 
                      type: 'string', 
                      example: 'Password must contain at least one uppercase letter.'
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Refresh access token using refresh token',
        description: 'Uses a refresh token to obtain a new access token. Returns a new JWT access token and refresh token on success.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  refresh_token: { 
                    type: 'string', 
                    description: 'The refresh token to use for obtaining a new access token',
                    example: 'your-refresh-token'
                  }
                },
                required: ['refresh_token']
              },
              example: {
                refresh_token: 'your-refresh-token'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Token refresh successful',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: 'New JWT access token' },
                    token_type: { type: 'string', example: 'bearer' },
                    expires_in: { type: 'integer', example: 3600 },
                    refresh_token: { type: 'string', description: 'New refresh token' },
                    user: { type: 'object' }
                  }
                },
                example: {
                  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                  token_type: 'bearer',
                  expires_in: 3600,
                  refresh_token: 'new-refresh-token',
                  user: { id: 'uuid', email: 'user@example.com' }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid refresh token or missing refresh token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Refresh token is required.' }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Invalid refresh token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Invalid refresh token.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/stripe/create-checkout-session': {
      post: {
        tags: ['Payments'],
        summary: 'Create Stripe Checkout Session',
        description: 'Creates a Stripe Checkout session for a given plan and returns the session URL.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  plan_id: { type: 'string', example: 'plan-uuid' }
                },
                required: ['plan_id']
              },
              example: { plan_id: 'plan-uuid' }
            }
          }
        },
        responses: {
          '200': {
            description: 'Checkout session created',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { type: 'string', example: 'https://checkout.stripe.com/pay/cs_test_...' }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '400': { description: 'Invalid plan' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/stripe/webhook': {
      post: {
        tags: ['Payments'],
        summary: 'Stripe Webhook',
        description: 'Handles Stripe webhook events for subscription management.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object' }
            }
          }
        },
        responses: {
          '200': { description: 'Webhook received' },
          '400': { description: 'Webhook error' }
        }
      }
    },
    '/subscription/plan': {
      get: {
        tags: ['Subscriptions'],
        summary: 'Get Current User Subscription Plan',
        description: 'Returns the current user\'s subscription plan and usage.',
        responses: {
          '200': {
            description: 'Current subscription',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    user_id: { type: 'string', format: 'uuid' },
                    plan_id: { type: 'string', format: 'uuid' },
                    status: { type: 'string', enum: ['active', 'inactive', 'canceled', 'past_due', 'trialing'] },
                    current_period_end: { type: 'string', format: 'date-time', nullable: true },
                    usage: {
                      type: 'object',
                      properties: {
                        requests_today: { type: 'integer', example: 0 },
                        requests_this_month: { type: 'integer', example: 0 },
                        requests_today_date: { type: 'string', format: 'date', example: '2025-06-09' },
                        requests_this_month_date: { type: 'string', example: '2025-06' },
                        mcp_server_count: { type: 'integer', example: 0, description: 'Current number of projects created by the user' }
                      }
                    },
                    created_at: { type: 'string', format: 'date-time' },
                    updated_at: { type: 'string', format: 'date-time' },
                    stripe_subscription_id: { type: 'string', nullable: true },
                    cancel_at_period_end: { type: 'boolean' },
                    plan: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        name: { type: 'string', example: 'Free' },
                        price: { type: 'number', example: 0 },
                        features: { type: 'object' },
                        created_at: { type: 'string', format: 'date-time' },
                        updated_at: { type: 'string', format: 'date-time' },
                        max_projects: { type: 'integer', example: 1 },
                        stripe_price_id: { type: 'string' },
                        max_custom_domains: { type: 'integer', example: 0 },
                        max_requests_per_day: { type: 'integer', example: 100 },
                        max_requests_per_month: { type: 'integer', example: 1000 }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '404': { description: 'No subscription found' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/subscription/plans': {
      get: {
        tags: ['Subscriptions'],
        summary: 'Get All Subscription Plans',
        description: 'Returns all available subscription plans.',
        responses: {
          '200': {
            description: 'List of plans',
            content: {
              'application/json': {
                schema: { type: 'array', items: { type: 'object' } }
              }
            }
          },
          '500': { description: 'Server error' }
        }
      }
    },
    '/subscription/cancel': {
      post: {
        tags: ['Subscriptions'],
        summary: 'Cancel Current User Subscription',
        description: 'Cancels the authenticated user\'s active subscription. Requires authentication.',
        responses: {
          '200': {
            description: 'Subscription canceled',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Subscription canceled' }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '404': { description: 'No active subscription found' },
          '500': { description: 'Failed to cancel subscription in Stripe or update status' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/subscription/resume': {
      post: {
        tags: ['Subscriptions'],
        summary: 'Resume (Uncancel) Current User Subscription',
        description: 'Resumes (uncancels) the authenticated user\'s subscription if it was set to cancel at period end. Requires authentication.',
        responses: {
          '200': {
            description: 'Subscription resumed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Subscription will continue and will not be canceled at period end.' }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '404': { description: 'No canceling subscription found' },
          '500': { description: 'Failed to resume subscription in Stripe or update status' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/auth/resend-confirmation': {
      post: {
        tags: ['Authentication'],
        summary: 'Resend Email Confirmation',
        description: `Resends the email confirmation link to the specified email address. Useful when the initial confirmation email was not received or expired.\n\nThe confirmation email will redirect to /auth/verify after the user clicks the link. If you need to customize the redirect, update the backend implementation.`,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { 
                    type: 'string', 
                    format: 'email',
                    description: 'The email address to resend the confirmation link to',
                    example: 'user@example.com'
                  }
                },
                required: ['email']
              },
              example: {
                email: 'user@example.com',
                redirectTo: 'https://mcpdploy.com/auth/verify'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Confirmation email sent successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Confirmation email sent successfully. Please check your inbox.'
                    },
                    debug: {
                      type: 'object',
                      properties: {
                        email: { type: 'string', example: 'user@example.com' },
                        redirectTo: { type: 'string', example: 'https://your-site.com/auth/verify' },
                        supabaseError: { type: 'object', nullable: true }
                      }
                    }
                  }
                },
                example: {
                  message: 'Confirmation email sent successfully. Please check your inbox.',
                  debug: {
                    email: 'user@example.com',
                    redirectTo: 'https://your-site.com/auth/verify',
                    supabaseError: null
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Email is required.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/change-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Change Password',
        description: 'Changes the password for the authenticated user. Requires the current password for verification.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  currentPassword: { 
                    type: 'string', 
                    description: 'The user\'s current password',
                    example: 'OldP@ssw0rd!'
                  },
                  newPassword: { 
                    type: 'string', 
                    description: 'The new password must be at least 8 characters long and contain at least one uppercase letter and one special character',
                    example: 'NewP@ssw0rd!',
                    minLength: 8
                  }
                },
                required: ['currentPassword', 'newPassword']
              },
              example: {
                currentPassword: 'OldP@ssw0rd!',
                newPassword: 'NewP@ssw0rd!'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Password changed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Password updated successfully.'
                    },
                    user: { type: 'object' }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request or incorrect current password',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Current password is incorrect.' }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized - missing or invalid token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Authorization header required' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Request Password Reset',
        description: 'Sends a password reset email to the specified email address. For security reasons, always returns success even if the email doesn\'t exist.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { 
                    type: 'string', 
                    format: 'email',
                    description: 'The email address to send the password reset link to',
                    example: 'user@example.com'
                  },
                  redirectTo: {
                    type: 'string',
                    format: 'url',
                    description: 'Optional URL to redirect to after the user clicks the reset link',
                    example: 'https://mcpdploy.com/reset-password'
                  }
                },
                required: ['email']
              },
              example: {
                email: 'user@example.com',
                redirect_to: 'https://mcpdploy.com/reset-password'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Request processed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'If an account exists with this email, a password reset link has been sent.'
                    }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Email is required.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/reset-password': {
      post: {
        tags: ['Authentication'],
        summary: 'Reset Password with Token',
        description: 'Resets the user\'s password using the access token received from the password reset email link.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  accessToken: { 
                    type: 'string', 
                    description: 'The access token from the password reset email link',
                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                  },
                  newPassword: { 
                    type: 'string', 
                    description: 'The new password must be at least 8 characters long and contain at least one uppercase letter and one special character',
                    example: 'NewP@ssw0rd!',
                    minLength: 8
                  }
                },
                required: ['accessToken', 'newPassword']
              },
              example: {
                accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                newPassword: 'NewP@ssw0rd!'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Password reset successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Password has been reset successfully.'
                    },
                    user: { type: 'object' }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request or password validation failed',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Password must contain at least one uppercase letter.' }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Invalid or expired token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Failed to reset password. The reset link may be expired or invalid.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/support/contact': {
      post: {
        tags: ['Support'],
        summary: 'Submit Support Request',
        description: 'Submit a support request. Can be used by both authenticated and anonymous users.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  subject: { 
                    type: 'string', 
                    description: 'The subject of the support request',
                    example: 'Unable to create new project'
                  },
                  message: { 
                    type: 'string', 
                    description: 'Detailed description of the issue or question',
                    example: 'I am getting an error when trying to create a new MCP project...'
                  },
                  category: { 
                    type: 'string', 
                    description: 'Category of the support request',
                    enum: ['general', 'technical', 'billing', 'feature-request', 'bug-report'],
                    example: 'technical'
                  }
                },
                required: ['subject', 'message']
              },
              example: {
                subject: 'Unable to create new project',
                message: 'I am getting an error when trying to create a new MCP project. The error says "Project limit reached" but I should have more projects available.',
                category: 'technical'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Support request submitted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Support request received. We\'ll get back to you soon.'
                    },
                    ticketId: { 
                      type: 'string',
                      format: 'uuid',
                      description: 'The ID of the created support ticket'
                    },
                    estimatedResponseTime: {
                      type: 'string',
                      example: '24-48 hours'
                    }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Subject and message are required.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Failed to submit support request.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/support/tickets': {
      get: {
        tags: ['Support'],
        summary: 'Get User Support Tickets',
        description: 'Retrieve all support tickets for the authenticated user.',
        responses: {
          '200': {
            description: 'List of support tickets',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      user_id: { type: 'string', format: 'uuid' },
                      user_email: { type: 'string', format: 'email' },
                      user_name: { type: 'string', nullable: true },
                      subject: { type: 'string' },
                      message: { type: 'string' },
                      category: { type: 'string' },
                      status: { type: 'string', enum: ['open', 'in-progress', 'resolved', 'closed'] },
                      created_at: { type: 'string', format: 'date-time' },
                      updated_at: { type: 'string', format: 'date-time', nullable: true }
                    }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Unauthorized' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Failed to fetch support tickets.' }
                  }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/auth/verify-token': {
      post: {
        tags: ['Authentication'],
        summary: 'Verify Email Confirmation',
        description: 'Verifies the user\'s email using the access token received from the confirmation email link. Returns the user object and token info if successful and the email is confirmed.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  access_token: {
                    type: 'string',
                    description: 'The access token from the confirmation email link',
                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
                  }
                },
                required: ['access_token']
              },
              example: {
                access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Email verified and user/token returned',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    access_token: { type: 'string', description: 'The JWT access token used for verification' },
                    token_type: { type: 'string', example: 'bearer' },
                    expires_in: { type: ['integer', 'null'], example: null, description: 'Token expiry in seconds (null if not available)' },
                    refresh_token: { type: ['string', 'null'], example: null, description: 'Refresh token (null if not available)' },
                    user: { type: 'object', description: 'The verified user object' }
                  }
                },
                example: {
                  access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                  token_type: 'bearer',
                  expires_in: null,
                  refresh_token: null,
                  user: {
                    id: 'uuid',
                    email: 'user@example.com',
                    confirmed_at: '2024-06-10T12:00:00.000Z',
                    // ...other user fields
                  }
                }
              }
            }
          },
          '400': {
            description: 'Missing or invalid access token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Access token is required.' }
                  }
                }
              }
            }
          },
          '403': {
            description: 'Email not confirmed or invalid/expired token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Email not confirmed.' }
                  }
                }
              }
            }
          },
          '500': {
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/google': {
      post: {
        tags: ['Authentication'],
        summary: 'Initiate Google OAuth Login',
        description: 'Returns a URL to redirect the user to Google for OAuth authentication. After authentication, Google will redirect back to your specified callback URL.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  redirectTo: {
                    type: 'string',
                    format: 'url',
                    description: 'URL to redirect to after successful authentication',
                    example: 'https://mcpdploy.com/auth/callback'
                  }
                }
              },
              example: {
                redirectTo: 'https://mcpdploy.com/auth/callback'
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'OAuth URL generated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    url: { 
                      type: 'string', 
                      format: 'url',
                      description: 'Google OAuth URL to redirect the user to',
                      example: 'https://accounts.google.com/o/oauth2/v2/auth?...'
                    },
                    provider: {
                      type: 'string',
                      example: 'google'
                    }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Failed to initiate OAuth',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Failed to initiate Google login.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/providers': {
      get: {
        tags: ['Authentication'],
        summary: 'Get Available OAuth Providers',
        description: 'Returns a list of available OAuth providers that can be used for authentication.',
        responses: {
          '200': {
            description: 'List of providers',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    providers: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          name: { type: 'string', example: 'google' },
                          displayName: { type: 'string', example: 'Google' },
                          icon: { type: 'string', format: 'url', example: 'https://www.google.com/favicon.ico' },
                          enabled: { type: 'boolean', example: true }
                        }
                      }
                    }
                  }
                },
                example: {
                  providers: [
                    {
                      name: 'google',
                      displayName: 'Google',
                      icon: 'https://www.google.com/favicon.ico',
                      enabled: true
                    }
                  ]
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/oauth-callback': {
      post: {
        tags: ['Authentication'],
        summary: 'OAuth Callback Handler',
        description: 'Handles the OAuth callback after the user has authenticated with the provider. Verifies the session and returns user details.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  access_token: { type: 'string', description: 'Access token from OAuth provider' },
                  refresh_token: { type: 'string', description: 'Refresh token from OAuth provider' },
                  provider_token: { type: 'string', description: 'Provider-specific access token', nullable: true },
                  provider_refresh_token: { type: 'string', description: 'Provider-specific refresh token', nullable: true }
                },
                required: ['access_token']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'OAuth callback processed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user: { type: 'object', description: 'User details' },
                    access_token: { type: 'string' },
                    refresh_token: { type: 'string' },
                    provider_token: { type: 'string', nullable: true },
                    provider_refresh_token: { type: 'string', nullable: true },
                    isNewUser: { type: 'boolean', description: 'Whether this is a new user' }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Invalid OAuth session',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Invalid OAuth session.' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error.' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/deactivate': {
      post: {
        tags: ['Authentication'],
        summary: 'Deactivate User Account',
        description: 'Deactivates the user account with a 30-day grace period before permanent deletion. The user will be logged out and all sessions will be revoked.',
        responses: {
          '200': {
            description: 'Account deactivated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Account deactivated successfully. You have 30 days to reactivate your account before permanent deletion.'
                    },
                    deactivated_at: { 
                      type: 'string', 
                      format: 'date-time',
                      example: '2024-01-15T10:30:00Z' 
                    },
                    scheduled_deletion_at: { 
                      type: 'string', 
                      format: 'date-time',
                      example: '2024-02-14T10:30:00Z' 
                    }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized - invalid or missing token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Authorization header required' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error during account deactivation' }
                  }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/auth/reactivate': {
      post: {
        tags: ['Authentication'],
        summary: 'Reactivate User Account',
        description: 'Reactivates a deactivated user account within the 30-day grace period. Requires valid email and password for authentication.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  email: { 
                    type: 'string', 
                    format: 'email',
                    description: 'User email address',
                    example: 'user@example.com'
                  },
                  password: { 
                    type: 'string', 
                    description: 'User password',
                    example: 'MyP@ssw0rd!'
                  }
                },
                required: ['email', 'password']
              }
            }
          }
        },
        responses: {
          '200': {
            description: 'Account reactivated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { 
                      type: 'string', 
                      example: 'Account reactivated successfully. You can now login normally.'
                    },
                    reactivated_at: { 
                      type: 'string', 
                      format: 'date-time',
                      example: '2024-01-20T14:30:00Z' 
                    },
                    access_token: { type: 'string', description: 'JWT access token' },
                    refresh_token: { type: 'string', description: 'JWT refresh token' },
                    user: { type: 'object', description: 'User details' }
                  }
                }
              }
            }
          },
          '400': { 
            description: 'Invalid request - missing credentials or account not deactivated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Account is not deactivated' }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Invalid credentials',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Invalid credentials' }
                  }
                }
              }
            }
          },
          '410': { 
            description: 'Account is past the 30-day reactivation period',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Account is past the 30-day reactivation period and scheduled for deletion' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error during account reactivation' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/cleanup-deactivated-accounts': {
      post: {
        tags: ['Authentication'],
        summary: 'Cleanup Deactivated Accounts (Admin)',
        description: 'Administrative endpoint to permanently delete accounts that have been deactivated for more than 30 days. This endpoint should be called by a scheduled job/cron. Requires admin API key.',
        parameters: [
          {
            name: 'X-Admin-Key',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'Admin API key for authentication'
          }
        ],
        responses: {
          '200': {
            description: 'Cleanup completed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string', example: 'Account cleanup completed' },
                    processed: { type: 'integer', example: 5, description: 'Number of accounts processed' },
                    successful: { type: 'integer', example: 4, description: 'Number of accounts successfully deleted' },
                    failed: { type: 'integer', example: 1, description: 'Number of accounts that failed to delete' },
                    errors: { 
                      type: 'array', 
                      items: {
                        type: 'object',
                        properties: {
                          userId: { type: 'string', format: 'uuid' },
                          error: { type: 'string' },
                          step: { type: 'string', enum: ['auth_deletion', 'unexpected_error'] }
                        }
                      },
                      description: 'Details of any deletion failures'
                    }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized - invalid or missing admin key',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Unauthorized' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error during cleanup' }
                  }
                }
              }
            }
          }
        }
      }
    },
    '/auth/account-status': {
      get: {
        tags: ['Authentication'],
        summary: 'Get Account Status',
        description: 'Returns the current status of the authenticated user\'s account, including deactivation information if applicable.',
        responses: {
          '200': {
            description: 'Account status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    user_id: { type: 'string', format: 'uuid' },
                    email: { type: 'string', format: 'email' },
                    account_status: { 
                      type: 'string', 
                      enum: ['active', 'deactivated'],
                      example: 'active'
                    },
                    created_at: { type: 'string', format: 'date-time' },
                    deactivated_at: { 
                      type: 'string', 
                      format: 'date-time',
                      nullable: true,
                      description: 'Present only if account is deactivated'
                    },
                    scheduled_deletion_at: { 
                      type: 'string', 
                      format: 'date-time',
                      nullable: true,
                      description: 'Present only if account is deactivated'
                    },
                    days_until_deletion: { 
                      type: 'integer',
                      nullable: true,
                      description: 'Present only if account is deactivated'
                    },
                    can_reactivate: { 
                      type: 'boolean',
                      nullable: true,
                      description: 'Present only if account is deactivated'
                    }
                  }
                },
                examples: {
                  active_account: {
                    summary: 'Active account',
                    value: {
                      user_id: '123e4567-e89b-12d3-a456-426614174000',
                      email: 'user@example.com',
                      account_status: 'active',
                      created_at: '2024-01-01T00:00:00Z'
                    }
                  },
                  deactivated_account: {
                    summary: 'Deactivated account',
                    value: {
                      user_id: '123e4567-e89b-12d3-a456-426614174000',
                      email: 'user@example.com',
                      account_status: 'deactivated',
                      created_at: '2024-01-01T00:00:00Z',
                      deactivated_at: '2024-01-15T10:30:00Z',
                      scheduled_deletion_at: '2024-02-14T10:30:00Z',
                      days_until_deletion: 20,
                      can_reactivate: true
                    }
                  }
                }
              }
            }
          },
          '401': { 
            description: 'Unauthorized - invalid or missing token',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Authorization header required' }
                  }
                }
              }
            }
          },
          '500': { 
            description: 'Server error',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: { type: 'string', example: 'Internal server error' }
                  }
                }
              }
            }
          }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/summary': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Analytics Summary',
        description: 'Returns a comprehensive analytics summary for the authenticated user including usage stats, errors, and top endpoints.',
        responses: {
          '200': {
            description: 'Analytics summary',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    summary: { type: 'object', description: 'User analytics summary from view' },
                    today_stats: { type: 'object', nullable: true, description: 'Today\'s detailed statistics' },
                    month_stats: { type: 'object', nullable: true, description: 'This month\'s aggregated statistics' },
                    recent_errors: { 
                      type: 'array', 
                      items: { type: 'object' },
                      description: 'Recent error entries'
                    },
                    top_endpoints: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          endpoint: { type: 'string' },
                          count: { type: 'integer' }
                        }
                      },
                      description: 'Most frequently accessed endpoints'
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/daily': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Daily Analytics',
        description: 'Returns daily analytics data for a specified date range.',
        parameters: [
          {
            name: 'start_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            description: 'Start date (YYYY-MM-DD)'
          },
          {
            name: 'end_date',
            in: 'query',
            required: true,
            schema: { type: 'string', format: 'date' },
            description: 'End date (YYYY-MM-DD)'
          }
        ],
        responses: {
          '200': {
            description: 'Daily analytics data',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object' }
                }
              }
            }
          },
          '400': { description: 'Invalid parameters' },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/monthly': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Monthly Analytics',
        description: 'Returns monthly analytics data.',
        parameters: [
          {
            name: 'year',
            in: 'query',
            required: false,
            schema: { type: 'integer' },
            description: 'Filter by year'
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 12 },
            description: 'Number of months to return'
          }
        ],
        responses: {
          '200': {
            description: 'Monthly analytics data',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object' }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/logs': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Detailed Analytics Logs',
        description: 'Returns paginated detailed analytics logs with filtering options.',
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: 'Page number'
          },
          {
            name: 'page_size',
            in: 'query',
            schema: { type: 'integer', default: 50 },
            description: 'Number of items per page'
          },
          {
            name: 'start_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by start date'
          },
          {
            name: 'end_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by end date'
          },
          {
            name: 'status_code',
            in: 'query',
            schema: { type: 'integer' },
            description: 'Filter by HTTP status code'
          },
          {
            name: 'method',
            in: 'query',
            schema: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] },
            description: 'Filter by HTTP method'
          },
          {
            name: 'endpoint',
            in: 'query',
            schema: { type: 'string' },
            description: 'Filter by endpoint (partial match)'
          }
        ],
        responses: {
          '200': {
            description: 'Analytics logs with pagination',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'array', items: { type: 'object' } },
                    pagination: {
                      type: 'object',
                      properties: {
                        page: { type: 'integer' },
                        page_size: { type: 'integer' },
                        total: { type: 'integer' },
                        total_pages: { type: 'integer' }
                      }
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/projects': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Analytics by Project',
        description: 'Returns analytics data aggregated by project.',
        parameters: [
          {
            name: 'start_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by start date'
          },
          {
            name: 'end_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by end date'
          }
        ],
        responses: {
          '200': {
            description: 'Project analytics data',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      project_id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                      count: { type: 'integer' }
                    }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/performance': {
      get: {
        tags: ['Analytics'],
        summary: 'Get Performance Metrics',
        description: 'Returns performance metrics including response time percentiles.',
        parameters: [
          {
            name: 'period',
            in: 'query',
            schema: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' },
            description: 'Time period for metrics'
          },
          {
            name: 'project_id',
            in: 'query',
            schema: { type: 'string', format: 'uuid' },
            description: 'Filter by specific project'
          }
        ],
        responses: {
          '200': {
            description: 'Performance metrics',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    avg_response_time: { type: 'integer', description: 'Average response time in ms' },
                    p50_response_time: { type: 'integer', description: '50th percentile response time' },
                    p95_response_time: { type: 'integer', description: '95th percentile response time' },
                    p99_response_time: { type: 'integer', description: '99th percentile response time' },
                    min_response_time: { type: 'integer', description: 'Minimum response time' },
                    max_response_time: { type: 'integer', description: 'Maximum response time' },
                    total_requests: { type: 'integer', description: 'Total number of requests' }
                  }
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    },
    '/analytics/export': {
      get: {
        tags: ['Analytics'],
        summary: 'Export Analytics Data',
        description: 'Export analytics data in JSON or CSV format.',
        parameters: [
          {
            name: 'format',
            in: 'query',
            schema: { type: 'string', enum: ['json', 'csv'], default: 'json' },
            description: 'Export format'
          },
          {
            name: 'start_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by start date'
          },
          {
            name: 'end_date',
            in: 'query',
            schema: { type: 'string', format: 'date-time' },
            description: 'Filter by end date'
          }
        ],
        responses: {
          '200': {
            description: 'Exported data',
            content: {
              'application/json': {
                schema: {
                  type: 'array',
                  items: { type: 'object' }
                }
              },
              'text/csv': {
                schema: {
                  type: 'string',
                  description: 'CSV formatted data'
                }
              }
            }
          },
          '401': { description: 'Unauthorized' },
          '500': { description: 'Server error' }
        },
        security: [{ bearerAuth: [] }]
      }
    }
  }
}; 