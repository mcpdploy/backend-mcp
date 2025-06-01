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
          uri_pattern: { type: 'string', minLength: 1, example: '/data/config.json' },
          api_url: { type: 'string', format: 'url', example: 'https://api.example.com/resource_proxy', nullable: true },
          headers: { type: 'object', additionalProperties: { type: 'string' }, example: { 'Authorization': 'Bearer some_token' }, nullable: true }
        },
        required: ['name', 'uri_pattern']
      },
      BaseTool: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, example: 'Data Fetcher Tool' },
          description: { type: 'string', example: 'Fetches data from an external API.', nullable: true },
          api_url: { type: 'string', format: 'url', example: 'https://api.example.com/fetch-data', nullable: true },
          headers: { type: 'object', additionalProperties: { type: 'string' }, example: { 'X-API-Key': 'secretkey' }, nullable: true },
          parameters: { type: 'object', additionalProperties: { type: 'string' }, example: { query: 'search term description' }, nullable: true },
          http_method: { type: 'string', enum: ["GET", "POST", "PUT", "DELETE", "PATCH"], default: "GET", nullable: true }
        },
        required: ['name']
      },
      BasePrompt: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, example: 'Summarization Prompt' },
          description: { type: 'string', example: 'Generates a summary for a given text.', nullable: true },
          template: { type: 'string', minLength: 1, example: 'Summarize this: {{text_input}}' },
          parameters: { type: 'object', additionalProperties: { type: 'string' }, example: { text_input: 'The text to summarize' }, nullable: true }
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
                resources: [
                  { name: 'Config File', uri_pattern: '/config.json', api_url: 'https://example.com/api/config', headers: { 'X-API-KEY': 'mysecretkey' } }
                ],
                tools: [
                  { name: 'Echo Tool', description: 'Echoes input.', api_url: 'https://example.com/api/echo', headers: { 'X-Custom-Header': 'SomeValue' }, http_method: 'POST', parameters: { 'input': 'text to echo'} }
                ],
                prompts: [
                  { name: 'Greeting Prompt', description: 'A friendly greeting.', template: 'Hello, {{name}}!', parameters: { 'name': 'user name' } }
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
                  is_active: { type: 'boolean', example: true, nullable: true },
                  resources: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubResource' }, nullable: true },
                  tools: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubTool' }, nullable: true },
                  prompts: { type: 'array', items: { $ref: '#/components/schemas/ProjectSubPrompt' }, nullable: true }
                }
              },
              example: {
                name: 'My Super Project - Updated',
                description: 'Now with more awesomeness and full sub-item management.',
                version: '1.1.0',
                is_active: true,
                resources: [
                  { id: 'existing-resource-uuid', name: 'Main Data Source', uri_pattern: '/data/main.json', api_url: 'https://example.com/api/main', headers: { 'Authorization': 'Bearer mysecretkey' } },
                  { name: 'New Auxiliary Data', uri_pattern: '/data/aux.json', api_url: 'http://example.com/aux-proxy', headers: { 'X-API-KEY': 'newsecretkey' } }
                ],
                tools: [
                  { id: 'existing-tool-uuid', name: 'Advanced Calculation Tool', description: 'Performs advanced calculations.', http_method: 'POST', api_url: 'https://example.com/api/advanced-calculation', headers: { 'X-Custom-Header': 'SomeValue' } }
                ],
                prompts: []
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
    '/auth/login': {
      post: {
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
          '400': { description: 'Invalid signup data' }
        }
      }
    },
    '/auth/refresh': {
      post: {
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
        summary: 'Get Current User Subscription Plan',
        description: 'Returns the current user\'s subscription plan and usage.',
        responses: {
          '200': {
            description: 'Current subscription',
            content: {
              'application/json': {
                schema: { type: 'object' }
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
    }
  }
}; 