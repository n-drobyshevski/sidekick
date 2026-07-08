{
  "data": {
    "cloudResourcesV2": {
      "totalCount": 68,
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "eyJmaWVsZHMiOlt7IkZpZWxkIjoib2JqZWN0X2NyZWF0ZWRBdCIsIlZhbHVlIjoiMjAyNi0wNS0wOFQwNzo1MDoxNC4xMTIxNTRaIn0seyJGaWVsZCI6IkV4Y2x1ZGUiLCJWYWx1ZSI6WyJjZDBjNzBhMS1kZWQ1LTU1NzgtYTFmZS0xY2M5MGYyMDgwNTciXX1dfQ==",
        "__typename": "PageInfo"
      },
      "nodes": [
        {
          "id": "9c8ebcff-ff31-5fdc-976a-5e9db7cf0752",
          "name": "dpcp-ai-assistant-be",
          "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-preproduction-ck-z8g4/docker-images/dpcp-ai-assistant-backend@sha256:3262f869941b1e76499655a3e7461776d258e1a7530289a197d48cf07cc4425d##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "9c8ebcff-ff31-5fdc-976a-5e9db7cf0752",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "10e3115a-c891-5585-869d-48eaca8dd687",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "9187d6c4-67a9-5694-acb8-1e12fdbedeb9"
              ],
              "_vertexID": "9c8ebcff-ff31-5fdc-976a-5e9db7cf0752",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-preproduction-ck-z8g4/docker-images/dpcp-ai-assistant-backend@sha256:3262f869941b1e76499655a3e7461776d258e1a7530289a197d48cf07cc4425d##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dpcp-ai-assistant-be",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "James Hang",
              "reasoning": null,
              "region": "asia-southeast1",
              "resourceGroupExternalId": null,
              "snippet": "\\n            query = state.queries[-1]\\n\\n            prompt = ChatPromptTemplate.from_messages(\\n                [\\n                    (\"system\", await Prompt.get_rerank_docs()),\\n                    (\"placeholder\", \"{messages}\"),\\n                ]\\n            )\\n            message_value = await prompt.ainvoke(\\n                {\\n                    \"messages\": [HumanMessage(content=\"Show me reranked documents.\")],\\n                    \"query\": MessageUtils.to_markdown_block(query),\\n                    \"chunks\": MessageUtils.to_json_block(chunks_json),\\n                    \"response_structure\": MessageUtils.to_json_block(response_structure_json),\\n                },\\n                config,\\n            )\\n\\n            self.print_messages(message_value, \"rerank_docs_prompt\")\\n\\n            model = self.ai_service_provider.get_rerank_model()\\n            response = await  model.ainvoke(\\n                input=message_value,\\n                config=config,\\n            )\\n\\n            configuration = Configuration.from_runnable_config(config)\\n            top_k = configuration.rerank_top_k\\n            # Currently top_p is ignored to avoid empty answer\\n            ranked_docs = self._rerank_docs(response.content, top_k, 0, document_map)\\n\\n            logger().info(f\"===RagWorkflow==rerank==docs==query==== documents: {len(documents)}, {query}\")\\n\\n            return {\"context\": ranked_docs}\\n        except Exception:\\n            logger().exception(f\"===RagWorkflow==rerank==docs==failed===\")\\n            raise\\n        finally:\\n            end_time = time.perf_counter()\\n            logger().info(f\"===RagWorkflow==rerank==docs=== elapsed_time={end_time - start_time:.4f} seconds\")\\n\\n    async def generate_response(self, state: State, *, config: RunnableConfig) -> dict[str, Any]:\\n        \"\"\"Call the LLM powering our \"agent\".\"\"\"\\n        # Feel free to customize the prompt, model, and other logic!\\n        start_time = time.perf_counter()\\n        try:\\n            if not state.queries:\\n                logger().warning(f\"===RagWorkflow==generate==response==no==query===\")\\n                return {\"context\": []}\\n\\n            documents = state.context\\n\\n            # Collect metadata\\n            resource_id_set: set[str] = set()\\n            metadata_list: list[dict] = []\\n            retrieved_documents: list[dict] = []\\n\\n            configuration = Configuration.from_runnable_config(config)\\n            for document in documents:\\n                doc_metadata = document.metadata\\n\\n                if configuration.return_retrieved_documents:\\n                    document_id = document.id\\n                    doc_content = document.page_content\\n                    retrieved_documents.append({\\n                        \"id\": document_id,\\n                        \"content\": doc_content,\\n                        \"metadata\": doc_metadata,\\n                    })\\n\\n                resource_id = doc_metadata.get(\"resource_id\")\\n                if resource_id:\\n                    if resource_id not in resource_id_set:\\n                        resource_id_set.add(resource_id)\\n                        if doc_metadata:\\n                            metadata_list.append(doc_metadata)\\n                else:\\n                    if doc_metadata:\\n                        metadata_list.append(doc_metadata)\\n            writer = get_stream_writer()\\n            writer({\"document_metadata\": metadata_list})\\n            writer({\"retrieved_documents\": retrieved_documents})\\n\\n            formatted_docs = MessageUtils.format_docs(documents)\\n\\n            query = state.queries[-1]\\n            human_input = [HumanMessage(content=query)]\\n            logger().info(f\"===RagWorkflow==generate==response==query===  documents: {len(documents)}, query: {query}\")\\n\\n            prompt = ChatPromptTemplate.from_messages(\\n                [\\n                    (\"system\", await Prompt.get_generate_response()),\\n                    (\"placeholder\", \"{messages}\"),\\n                ]\\n            )\\n            message_value = await prompt.ainvoke(\\n                {\\n                    \"messages\": human_input,\\n                    \"context\": MessageUtils.to_markdown_block(formatted_docs),\\n                },\\n                config,\\n            )\\n\\n            self.print_messages(message_value, \"generate_response_prompt\")\\n\\n            model = self.ai_service_provider.get_response_model()\\n            response = await model.ainvoke(\\n                input=message_value,\\n                config=config,\\n            )\\n            return {\\n                \"messages\": [response],\\n                # Add document_metadata to state so that it will be stored in state snapshot.\\n                \"document_metadata\": metadata_list,\\n            }\\n        except Exception:\\n            logger().exception(f\"===RagWorkflow==generate==response==failed===\")\\n            raise\\n        finally:\\n            end_time = time.perf_counter()\\n            logger().info(f\"===RagWorkflow==generate==response=== elapsed_time={end_time - start_time:.4f} seconds\")\\n\\n    def _create_workflow_builder(self) -> StateGraph:\\n        builder = StateGraph(state_schema=State, input_schema=InputState, context_schema=Configuration)\\n        builder.add_node(NodeName.REFINE_QUERY, self.refine_query)\\n        builder.add_node(NodeName.RETRIEVE_DOCS, self.retrieve_docs)\\n        builder.add_node(NodeName.RERANK_DOCS, self.rerank_docs)\\n        builder.add_node(NodeName.GENERATE_RESPONSE, self.generate_response)\\n        builder.add_edge(START, NodeName.REFINE_QUERY)\\n        builder.add_edge(NodeName.REFINE_QUERY, NodeName.RETRIEVE_DOCS)\\n        builder.add_edge(NodeName.RETRIEVE_DOCS, NodeName.RERANK_DOCS)\\n        builder.add_edge(NodeName.RERANK_DOCS, NodeName.GENERATE_RESPONSE)\\n        builder.add_edge(NodeName.GENERATE_RESPONSE, END)\\n        return builder\\n\\n    def get_workflow_builder(self) -> StateGraph:\\n        return self.workflow_builder\\n",
              "status": "Active",
              "subscriptionExternalId": "dpcp-preproduction-ck-z8g4",
              "updatedAt": "2026-07-06T15:38:16Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dpcp-ai-assistant-be",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "a7c07305-e757-5f15-b687-0fc47f5d00cb",
            "name": "dpcp-preproduction-ck-z8g4",
            "cloudProvider": "GCP",
            "externalId": "dpcp-preproduction-ck-z8g4",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "asia-southeast1",
          "regionLocation": "SG",
          "tags": null,
          "projects": [
            {
              "id": "10e3115a-c891-5585-869d-48eaca8dd687",
              "name": "CE-DPCP-PORTAL",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "9187d6c4-67a9-5694-acb8-1e12fdbedeb9",
              "name": "provisioning-CE-DPCP-PORTAL",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-06T15:38:16.899777Z",
          "deletedAt": null,
          "firstSeen": "2026-07-06T14:16:47.459751Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "67232012-f948-59b0-836b-15c620c74d18",
          "name": "impl",
          "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-preproduction-ck-z8g4/docker-images/dpcp-ai-assistant-backend@sha256:3262f869941b1e76499655a3e7461776d258e1a7530289a197d48cf07cc4425d##/app/gcp/api/impl",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "67232012-f948-59b0-836b-15c620c74d18",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "10e3115a-c891-5585-869d-48eaca8dd687",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "9187d6c4-67a9-5694-acb8-1e12fdbedeb9"
              ],
              "_vertexID": "67232012-f948-59b0-836b-15c620c74d18",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app/gcp/api/impl",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-preproduction-ck-z8g4/docker-images/dpcp-ai-assistant-backend@sha256:3262f869941b1e76499655a3e7461776d258e1a7530289a197d48cf07cc4425d##/app/gcp/api/impl",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "impl",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "asia-southeast1",
              "resourceGroupExternalId": null,
              "snippet": "from typing import Annotated\\n\\nfrom langchain_core.documents import Document\\nfrom langchain_core.---REDACTED--- import BaseMessage, HumanMessage\\nfrom langchain_core.runnables import RunnableConfig\\nfrom langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings\\nfrom langgraph.graph import StateGraph, START, END\\nfrom langgraph.graph.message import add_---REDACTED---\\nfrom pydantic import BaseModel\\n\\nfrom gcp.gcp_utils import GcpUtils\\nfrom primary_app.ai.ai_service_provider import VertexAIServiceProvider\\nfrom primary_app.ai.vector_db_provider import PGVectorDBAgent\\nfrom primary_app.config.settings import settings\\nfrom primary_app.constants import AIPlatform\\nfrom primary_app.util.app_utils import AppUtils\\n\\n# 1. Load the credentials from your JSON key file\\ncredentials = ---REDACTED---()\\n\\n# --- 1. Set up the Vertex AI Model ---\\n# Ensure you are authenticated (e.g., `gcloud auth ---REDACTED---`)\\n# You can specify your project and location if they aren't inferred from the environment.\\n# https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions\\n# https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models\\nllm = ChatGoogleGenerativeAI(\\n    project=settings().gcp_project_id,\\n    credentials=credentials,\\n    model=settings().get_query_model(AIPlatform.VERTEXAI.name),\\n    temperature=0,\\n    max_retries=2,\\n    vertexai=True,\\n)\\n\\nembedding_model = GoogleGenerativeAIEmbeddings(\\n    project=settings().gcp_project_id,\\n    credentials=credentials,\\n    model=settings().get_embedding_model(AIPlatform.VERTEXAI.name),\\n    output_dimensionality=settings().vector_size,\\n)\\n\\n\\n# --- 2. Define the Graph State ---\\n# We use a standard state that holds a list of ---REDACTED---.\\n# 'add_---REDACTED---' ensures new ---REDACTED--- are appended to the history rather than overwriting it.\\nclass State(BaseModel):\\n    ---REDACTED---: Annotated[list[BaseMessage], add_---REDACTED---]\\n\\n\\n# --- 3. Define the Nodes ---\\nasync def call_model(state: State):\\n    \"\"\"\\n    The main node that calls the Vertex AI model.\\n    It takes the current state (---REDACTED---), sends them to the LLM,\\n    and returns the LLM's response.\\n    \"\"\"\\n    print(\"--- Calling Vertex AI ---\")\\n    ---REDACTED--- = state.---REDACTED---\\n    response = await llm.ainvoke(---REDACTED---)\\n\\n    # Return a dict to update the state. The key '---REDACTED---' will match\\n    # the State definition and append this new response.\\n    return {\"---REDACTED---\": [response]}\\n\\n\\n# --- 4. Build the Graph ---\\nworkflow = StateGraph(State)\\n\\n# Add the node we defined above\\nworkflow.add_node(\"agent\", call_model)\\n\\n# Define the flow: Start -> Agent -> End\\nworkflow.add_edge(START, \"agent\")\\nworkflow.add_edge(\"agent\", END)\\n\\n# Compile the graph into a runnable application\\napp = workflow.compile()\\n\\n\\nasync def chat_stream(thread_id: str, ---REDACTED---: str, message: str):\\n    # Initial input from the user\\n    ---REDACTED---{\\n        \"---REDACTED---\": [HumanMessage(content=message)]\\n    }\\n\\n    if not thread_id:\\n        thread_id = ---REDACTED---()\\n    config = RunnableConfig(\\n        configurable={\"thread_id\": thread_id, \"---REDACTED---\": ---REDACTED---, \"rerank_top_k\": 5, \"rerank_top_p\": 0.5})\\n\\n    response = app.astream(\\n        input=initial_input,\\n        config=config,\\n        stream_mode=\"---REDACTED---\",\\n    )\\n\\n    return response\\n\\n\\nasync def do_test_chat_stream(message: str):\\n    thread_id = ---REDACTED---()\\n    ---REDACTED--- = ---REDACTED---()\\n    response = await chat_stream(thread_id=thread_id, ---REDACTED---=---REDACTED---, message=message)\\n    async for chunk in response:\\n        print(f\"========chunk: {str(chunk)}\")\\n\\n\\nasync def add_documents(docs: list[Document]) -> list[str]:\\n    vector_db_provider = PGVectorDBAgent(VertexAIServiceProvider())\\n    ids = await vector_db_provider.add_documents(documents=docs, table_name=\"sd_embeddings\")\\n    return ids\\n\\n\\n# --- 5. Run the Graph ---\\nif __name__ == \"__main__\":\\n    import asyncio\\n\\n    test_message = \"What is the bigest city of UK?\"\\n    asyncio.run(do_test_chat_stream(test_message))\\n    # docs = [\\n    #     Document(\\n    #         page_content=\"This is a test document about Paris.\",\\n    #         metadata={\"source\": \"test001\"}\\n    #     ),\\n    #     Document(\\n    #         page_content=\"This is another test document about the Eiffel Tower.\",\\n    #         metadata={\"source\": \"test001\"}\\n    #     )\\n    # ]\\n    # ids = asyncio.run(add_documents(docs))\\n    # print(ids)\\n",
              "status": "Active",
              "subscriptionExternalId": "dpcp-preproduction-ck-z8g4",
              "updatedAt": "2026-07-06T15:38:16Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "impl",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "a7c07305-e757-5f15-b687-0fc47f5d00cb",
            "name": "dpcp-preproduction-ck-z8g4",
            "cloudProvider": "GCP",
            "externalId": "dpcp-preproduction-ck-z8g4",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "asia-southeast1",
          "regionLocation": "SG",
          "tags": null,
          "projects": [
            {
              "id": "10e3115a-c891-5585-869d-48eaca8dd687",
              "name": "CE-DPCP-PORTAL",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "9187d6c4-67a9-5694-acb8-1e12fdbedeb9",
              "name": "provisioning-CE-DPCP-PORTAL",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-06T15:38:16.872641Z",
          "deletedAt": null,
          "firstSeen": "2026-07-06T14:16:47.353649Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "8643a5fb-0544-5dfa-9cda-b08141e9257c",
          "name": "dpcp-ai-assistant-be",
          "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-production-ck-8ytk/docker-images/dpcp-ai-assistant-backend@sha256:2c74a24dcc9a47bab35350a9d8675df8823b44719575fcec590fe7d38b36b35f##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "8643a5fb-0544-5dfa-9cda-b08141e9257c",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "10e3115a-c891-5585-869d-48eaca8dd687",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "9187d6c4-67a9-5694-acb8-1e12fdbedeb9"
              ],
              "_vertexID": "8643a5fb-0544-5dfa-9cda-b08141e9257c",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-production-ck-8ytk/docker-images/dpcp-ai-assistant-backend@sha256:2c74a24dcc9a47bab35350a9d8675df8823b44719575fcec590fe7d38b36b35f##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dpcp-ai-assistant-be",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "James Hang",
              "reasoning": null,
              "region": "asia-southeast1",
              "resourceGroupExternalId": null,
              "snippet": "                    response_content = self.extract_pure_json(response_content)\\n                    rerank_response = RerankResponse.model_validate_json(response_content)\\n                    configuration = Configuration.from_runnable_config(config)\\n                    top_p = configuration.rerank_top_p\\n                    temp_ranked_chunks = []\\n                    for item in rerank_response.ranked_chunks:\\n                        if item.score >= top_p:\\n                            temp_ranked_chunks.append(item)\\n                    ranked_chunks = sorted(temp_ranked_chunks, key=lambda x: ---REDACTED---, reverse=True)\\n                    if ranked_chunks:\\n                        top_k = configuration.rerank_top_k\\n                        top_k = max(1, min(top_k, len(ranked_chunks)))\\n                        top_k_ids = [item.id for item in ranked_chunks[:top_k]]\\n                        ranked_docs = [document_map[doc_id] for doc_id in top_k_ids if doc_id in document_map]\\n                    else:\\n                        ranked_docs = []\\n                except Exception:\\n                    try:\\n                        resp_content = response.content\\n                    except Exception:\\n                        resp_content = \"\"\\n                    logger().exception(f\"===RagWorkflow==rerank==docs==failed=== {resp_content}\")\\n                    raise\\n\\n            if ranked_docs is None:\\n                ranked_docs = context\\n\\n            return {\"context\": ranked_docs}\\n        except Exception:\\n            logger().exception(f\"===RagWorkflow==rerank==docs==failed===\")\\n            raise\\n        finally:\\n            end_time = time.perf_counter()\\n            logger().info(f\"===RagWorkflow==rerank==docs=== elapsed_time={end_time - start_time:.4f} seconds\")\\n\\n    async def generate_response(self, state: State, *, config: RunnableConfig) -> dict[str, Any]:\\n        \"\"\"Call the LLM powering our \"agent\".\"\"\"\\n        # Feel free to customize the prompt, model, and other logic!\\n        start_time = time.perf_counter()\\n        try:\\n            if not state.queries:\\n                logger().warning(f\"===RagWorkflow==generate==response==no==query===\")\\n                return {\"context\": []}\\n\\n            prompt = ChatPromptTemplate.from_messages(\\n                [\\n                    (\"system\", await Prompt.get_generate_response()),\\n                    (\"placeholder\", \"{messages}\"),\\n                ]\\n            )\\n            documents = state.context\\n\\n            # Collect metadata\\n            resource_id_set: set[str] = set()\\n            metadata_list: list[dict] = []\\n            retrieved_documents: list[dict] = []\\n\\n            configuration = Configuration.from_runnable_config(config)\\n            for document in documents:\\n                doc_metadata = document.metadata\\n\\n                if configuration.return_retrieved_documents:\\n                    document_id = document.id\\n                    doc_content = document.page_content\\n                    retrieved_documents.append({\\n                        \"id\": document_id,\\n                        \"content\": doc_content,\\n                        \"metadata\": doc_metadata,\\n                    })\\n\\n                resource_id = doc_metadata.get(\"resource_id\")\\n                if resource_id:\\n                    if resource_id not in resource_id_set:\\n                        resource_id_set.add(resource_id)\\n                        if doc_metadata:\\n                            metadata_list.append(doc_metadata)\\n                else:\\n                    if doc_metadata:\\n                        metadata_list.append(doc_metadata)\\n            writer = get_stream_writer()\\n            writer({\"document_metadata\": metadata_list})\\n            writer({\"retrieved_documents\": retrieved_documents})\\n\\n            context = MessageUtils.format_docs(documents)\\n            query = state.queries[-1]\\n            logger().info(f\"===RagWorkflow==generate==query=== {query}\")\\n            human_input = [HumanMessage(content=query)]\\n            message_value = await prompt.ainvoke(\\n                {\\n                    \"messages\": human_input,\\n                    \"context\": context,\\n                },\\n                config,\\n            )\\n\\n            self.print_messages(message_value, \"generate_response_prompt\")\\n\\n            model = self.ai_service_provider.get_response_model()\\n            response = await model.ainvoke(\\n                input=message_value,\\n                config=config,\\n            )\\n            return {\\n                \"messages\": [response],\\n                # Add document_metadata to state so that it will be stored in state snapshot.\\n                \"document_metadata\": metadata_list,\\n            }\\n        except Exception:\\n            logger().exception(f\"===RagWorkflow==generate==response==failed===\")\\n            raise\\n        finally:\\n            end_time = time.perf_counter()\\n            logger().info(f\"===RagWorkflow==generate==response=== elapsed_time={end_time - start_time:.4f} seconds\")\\n\\n    def _create_workflow_builder(self) -> StateGraph:\\n        builder = StateGraph(state_schema=State, input_schema=InputState, context_schema=Configuration)\\n        builder.add_node(NodeName.REFINE_QUERY, self.refine_query)\\n        builder.add_node(NodeName.RETRIEVE_DOCS, self.retrieve_docs)\\n        builder.add_node(NodeName.RERANK_DOCS, self.rerank_docs)\\n        builder.add_node(NodeName.GENERATE_RESPONSE, self.generate_response)\\n        builder.add_edge(START, NodeName.REFINE_QUERY)\\n        builder.add_edge(NodeName.REFINE_QUERY, NodeName.RETRIEVE_DOCS)\\n        builder.add_edge(NodeName.RETRIEVE_DOCS, NodeName.RERANK_DOCS)\\n        builder.add_edge(NodeName.RERANK_DOCS, NodeName.GENERATE_RESPONSE)\\n        builder.add_edge(NodeName.GENERATE_RESPONSE, END)\\n        return builder\\n\\n    def get_workflow_builder(self) -> StateGraph:\\n        return self.workflow_builder\\n",
              "status": "Active",
              "subscriptionExternalId": "dpcp-production-ck-8ytk",
              "updatedAt": "2026-07-05T11:27:02Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dpcp-ai-assistant-be",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "adfcb4fb-cb81-5966-8979-389d57106532",
            "name": "dpcp-production-ck-8ytk",
            "cloudProvider": "GCP",
            "externalId": "dpcp-production-ck-8ytk",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "asia-southeast1",
          "regionLocation": "SG",
          "tags": null,
          "projects": [
            {
              "id": "10e3115a-c891-5585-869d-48eaca8dd687",
              "name": "CE-DPCP-PORTAL",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "9187d6c4-67a9-5694-acb8-1e12fdbedeb9",
              "name": "provisioning-CE-DPCP-PORTAL",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T11:27:02.717305Z",
          "deletedAt": null,
          "firstSeen": "2026-07-02T19:55:30.216069Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "74c625d9-d1e8-56ac-b68f-d6d40a6ccecc",
          "name": "impl",
          "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-production-ck-8ytk/docker-images/dpcp-ai-assistant-backend@sha256:2c74a24dcc9a47bab35350a9d8675df8823b44719575fcec590fe7d38b36b35f##/app/gcp/api/impl",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "74c625d9-d1e8-56ac-b68f-d6d40a6ccecc",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "10e3115a-c891-5585-869d-48eaca8dd687",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "9187d6c4-67a9-5694-acb8-1e12fdbedeb9"
              ],
              "_vertexID": "74c625d9-d1e8-56ac-b68f-d6d40a6ccecc",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app/gcp/api/impl",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##asia-southeast1-docker.pkg.dev##dpcp-production-ck-8ytk/docker-images/dpcp-ai-assistant-backend@sha256:2c74a24dcc9a47bab35350a9d8675df8823b44719575fcec590fe7d38b36b35f##/app/gcp/api/impl",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "impl",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "asia-southeast1",
              "resourceGroupExternalId": null,
              "snippet": "from typing import Annotated\\n\\nfrom langchain_core.documents import Document\\nfrom langchain_core.---REDACTED--- import BaseMessage, HumanMessage\\nfrom langchain_core.runnables import RunnableConfig\\nfrom langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings\\nfrom langgraph.graph import StateGraph, START, END\\nfrom langgraph.graph.message import add_---REDACTED---\\nfrom pydantic import BaseModel\\n\\nfrom gcp.gcp_utils import GcpUtils\\nfrom primary_app.ai.ai_service_provider import VertexAIServiceProvider\\nfrom primary_app.ai.vector_db_provider import PGVectorDBAgent\\nfrom primary_app.config.settings import settings\\nfrom primary_app.constants import AIPlatform\\nfrom primary_app.util.app_utils import AppUtils\\n\\n# 1. Load the credentials from your JSON key file\\ncredentials = ---REDACTED---()\\n\\n# --- 1. Set up the Vertex AI Model ---\\n# Ensure you are authenticated (e.g., `gcloud auth ---REDACTED---`)\\n# You can specify your project and location if they aren't inferred from the environment.\\n# https://docs.cloud.google.com/vertex-ai/generative-ai/docs/learn/model-versions\\n# https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models\\nllm = ChatGoogleGenerativeAI(\\n    project=settings().gcp_project_id,\\n    # location=settings().gcp_service_location,\\n    credentials=credentials,\\n    model=settings().get_query_model(AIPlatform.VERTEXAI.name),\\n    temperature=0,\\n    max_retries=2,\\n    vertexai=True,\\n)\\n\\nembedding_model = GoogleGenerativeAIEmbeddings(\\n    project=settings().gcp_project_id,\\n    # location=settings().gcp_service_location,\\n    credentials=credentials,\\n    model=settings().get_embedding_model(AIPlatform.VERTEXAI.name),\\n    output_dimensionality=settings().vector_size,\\n)\\n\\n\\n# --- 2. Define the Graph State ---\\n# We use a standard state that holds a list of ---REDACTED---.\\n# 'add_---REDACTED---' ensures new ---REDACTED--- are appended to the history rather than overwriting it.\\nclass State(BaseModel):\\n    ---REDACTED---: Annotated[list[BaseMessage], add_---REDACTED---]\\n\\n\\n# --- 3. Define the Nodes ---\\nasync def call_model(state: State):\\n    \"\"\"\\n    The main node that calls the Vertex AI model.\\n    It takes the current state (---REDACTED---), sends them to the LLM,\\n    and returns the LLM's response.\\n    \"\"\"\\n    print(\"--- Calling Vertex AI ---\")\\n    ---REDACTED--- = state.---REDACTED---\\n    response = await llm.ainvoke(---REDACTED---)\\n\\n    # Return a dict to update the state. The key '---REDACTED---' will match\\n    # the State definition and append this new response.\\n    return {\"---REDACTED---\": [response]}\\n\\n\\n# --- 4. Build the Graph ---\\nworkflow = StateGraph(State)\\n\\n# Add the node we defined above\\nworkflow.add_node(\"agent\", call_model)\\n\\n# Define the flow: Start -> Agent -> End\\nworkflow.add_edge(START, \"agent\")\\nworkflow.add_edge(\"agent\", END)\\n\\n# Compile the graph into a runnable application\\napp = workflow.compile()\\n\\n\\nasync def chat_stream(thread_id: str, ---REDACTED---: str, message: str):\\n    # Initial input from the user\\n    ---REDACTED---{\\n        \"---REDACTED---\": [HumanMessage(content=message)]\\n    }\\n\\n    if not thread_id:\\n        thread_id = ---REDACTED---()\\n    config = RunnableConfig(\\n        configurable={\"thread_id\": thread_id, \"---REDACTED---\": ---REDACTED---, \"rerank_top_k\": 5, \"rerank_top_p\": 0.5})\\n\\n    response = app.astream(\\n        input=initial_input,\\n        config=config,\\n        stream_mode=\"---REDACTED---\",\\n    )\\n\\n    return response\\n\\n\\nasync def do_test_chat_stream(message: str):\\n    thread_id = ---REDACTED---()\\n    ---REDACTED--- = ---REDACTED---()\\n    response = await chat_stream(thread_id=thread_id, ---REDACTED---=---REDACTED---, message=message)\\n    async for chunk in response:\\n        print(f\"========chunk: {str(chunk)}\")\\n\\n\\nasync def add_documents(docs: list[Document]) -> list[str]:\\n    vector_db_provider = PGVectorDBAgent(VertexAIServiceProvider())\\n    ids = await vector_db_provider.add_documents(documents=docs, table_name=\"sd_embeddings\")\\n    return ids\\n\\n\\n# --- 5. Run the Graph ---\\nif __name__ == \"__main__\":\\n    import asyncio\\n\\n    test_message = \"What is the bigest city of UK?\"\\n    asyncio.run(do_test_chat_stream(test_message))\\n    # docs = [\\n    #     Document(\\n    #         page_content=\"This is a test document about Paris.\",\\n    #         metadata={\"source\": \"test001\"}\\n    #     ),\\n    #     Document(\\n    #         page_content=\"This is another test document about the Eiffel Tower.\",\\n    #         metadata={\"source\": \"test001\"}\\n    #     )\\n    # ]\\n    # ids = asyncio.run(add_documents(docs))\\n    # print(ids)\\n",
              "status": "Active",
              "subscriptionExternalId": "dpcp-production-ck-8ytk",
              "updatedAt": "2026-07-05T11:27:02Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "impl",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "adfcb4fb-cb81-5966-8979-389d57106532",
            "name": "dpcp-production-ck-8ytk",
            "cloudProvider": "GCP",
            "externalId": "dpcp-production-ck-8ytk",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "asia-southeast1",
          "regionLocation": "SG",
          "tags": null,
          "projects": [
            {
              "id": "10e3115a-c891-5585-869d-48eaca8dd687",
              "name": "CE-DPCP-PORTAL",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "9187d6c4-67a9-5694-acb8-1e12fdbedeb9",
              "name": "provisioning-CE-DPCP-PORTAL",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T11:27:02.710006Z",
          "deletedAt": null,
          "firstSeen": "2026-07-02T19:55:30.177152Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "629058b7-e093-5ad3-b21b-b4882e0c29e6",
          "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
          "externalId": "projects/787523386063/locations/us-west1/reasoningEngines/9091967203196010496",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "629058b7-e093-5ad3-b21b-b4882e0c29e6",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/787523386063/locations/us-west1/reasoningEngines/9091967203196010496",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
                "884b97d1-bd17-537a-810a-1457f1979564"
              ],
              "_vertexID": "629058b7-e093-5ad3-b21b-b4882e0c29e6",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/9091967203196010496?project=ai-industry-pp-4yqw",
              "configPath": null,
              "creationDate": "2026-06-30T14:54:38.229851Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/787523386063/locations/us-west1/reasoningEngines/9091967203196010496",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/787523386063/locations/us-west1/reasoningEngines/9091967203196010496",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "ai-industry-pp-4yqw",
              "updatedAt": "2026-07-01T06:01:35Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f7c08550-a57f-5677-82ff-ac04e6924a3d",
            "name": "ai-industry-pp-4yqw",
            "cloudProvider": "GCP",
            "externalId": "ai-industry-pp-4yqw",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
              "name": "provisioning-CE-ANALYTICS-INDUSTRY",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "884b97d1-bd17-537a-810a-1457f1979564",
              "name": "CE-ANALYTICS-INDUSTRY",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-30T14:54:38.229851Z",
          "updatedAt": "2026-07-01T06:01:35.488768Z",
          "deletedAt": null,
          "firstSeen": "2026-07-01T02:33:22.859344Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "6bc2694f-35e0-53d5-8f9d-59bc49694422",
          "name": "StockBuddy",
          "externalId": "projects/787922697915/locations/europe-west1/reasoningEngines/4870528647791902720",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "6bc2694f-35e0-53d5-8f9d-59bc49694422",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/787922697915/locations/europe-west1/reasoningEngines/4870528647791902720",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "6bc2694f-35e0-53d5-8f9d-59bc49694422",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/4870528647791902720?project=shipperbox-yt2h",
              "configPath": null,
              "creationDate": "2026-06-23T09:53:27.049246Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/787922697915/locations/europe-west1/reasoningEngines/4870528647791902720",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "StockBuddy",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/787922697915/locations/europe-west1/reasoningEngines/4870528647791902720",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "shipperbox-yt2h",
              "updatedAt": "2026-06-25T00:03:07Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "StockBuddy",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "8cc292ad-4c44-51e0-a76c-7e923b745eb2",
            "name": "shipperbox",
            "cloudProvider": "GCP",
            "externalId": "shipperbox-yt2h",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-23T09:53:27.049246Z",
          "updatedAt": "2026-06-25T00:03:07.611772Z",
          "deletedAt": null,
          "firstSeen": "2026-06-23T22:09:29.591989Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "d4276e3a-0ac6-50e5-b7ad-19393e45900b",
          "name": "StockBuddy",
          "externalId": "projects/137843558114/locations/europe-west4/reasoningEngines/4634775762610683904",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "d4276e3a-0ac6-50e5-b7ad-19393e45900b",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/137843558114/locations/europe-west4/reasoningEngines/4634775762610683904",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "c4c815fb-70d0-5107-9d25-e5f17c889251",
                "e585c9d1-1723-5c9e-bbdc-47b0258c58aa"
              ],
              "_vertexID": "d4276e3a-0ac6-50e5-b7ad-19393e45900b",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west4/reasoning-engines/4634775762610683904?project=sap-nonprodpartner-xe3x",
              "configPath": null,
              "creationDate": "2026-06-22T14:19:32.883014Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/137843558114/locations/europe-west4/reasoningEngines/4634775762610683904",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "StockBuddy",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/137843558114/locations/europe-west4/reasoningEngines/4634775762610683904",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "sap-nonprodpartner-xe3x",
              "updatedAt": "2026-06-24T23:56:25Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "StockBuddy",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "ef8440c1-88f0-516a-81bf-7f412d9e4b20",
            "name": "sap-nonprodpartner",
            "cloudProvider": "GCP",
            "externalId": "sap-nonprodpartner-xe3x",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "provisioning-CS-INFRA-HIGHWAY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-22T14:19:32.883014Z",
          "updatedAt": "2026-06-24T23:56:25.057599Z",
          "deletedAt": null,
          "firstSeen": "2026-06-22T20:08:05.930671Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "efe8ebf9-1d88-591c-82f7-48a034d724bb",
          "name": "StockBuddy",
          "externalId": "projects/1025925415766/locations/europe-west1/reasoningEngines/7542289126729449472",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "efe8ebf9-1d88-591c-82f7-48a034d724bb",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/1025925415766/locations/europe-west1/reasoningEngines/7542289126729449472",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "48639ef8-54bb-5e5c-a827-8908ea160eee",
                "f7b15f3e-e7fd-5c89-9f51-13bc9c3f4b89"
              ],
              "_vertexID": "efe8ebf9-1d88-591c-82f7-48a034d724bb",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/7542289126729449472?project=talend-supply-monitoring-udhu",
              "configPath": null,
              "creationDate": "2026-06-22T14:13:23.278054Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/1025925415766/locations/europe-west1/reasoningEngines/7542289126729449472",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "StockBuddy",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/1025925415766/locations/europe-west1/reasoningEngines/7542289126729449472",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "talend-supply-monitoring-udhu",
              "updatedAt": "2026-06-24T23:47:25Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "StockBuddy",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "3c3623ca-dbba-5da3-9149-54ebde83eba4",
            "name": "talend-supply-monitoring-udhu",
            "cloudProvider": "GCP",
            "externalId": "talend-supply-monitoring-udhu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "48639ef8-54bb-5e5c-a827-8908ea160eee",
              "name": "provisioning-CS-SUPPLY-MONITORING",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "f7b15f3e-e7fd-5c89-9f51-13bc9c3f4b89",
              "name": "CS-SUPPLY-MONITORING",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-22T14:13:23.278054Z",
          "updatedAt": "2026-06-24T23:47:25.572133Z",
          "deletedAt": null,
          "firstSeen": "2026-06-22T19:57:38.617967Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "c4a45679-5505-5eb7-9127-9b23493ae2b2",
          "name": "StockBuddy",
          "externalId": "projects/242837787210/locations/europe-west1/reasoningEngines/2372156754508120064",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "c4a45679-5505-5eb7-9127-9b23493ae2b2",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/242837787210/locations/europe-west1/reasoningEngines/2372156754508120064",
            "properties": {
              "_productIDs": [
                "147d4ac3-3f84-5a94-b796-7acc89705432",
                "15562a4f-affa-50bb-b1b9-e1b209d12855",
                "1dfea0cf-834f-5522-b797-bee5aaf09251"
              ],
              "_vertexID": "c4a45679-5505-5eb7-9127-9b23493ae2b2",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/2372156754508120064?project=aigovernance-gr6d",
              "configPath": null,
              "creationDate": "2026-06-22T14:02:43.444506Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/242837787210/locations/europe-west1/reasoningEngines/2372156754508120064",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "StockBuddy",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/242837787210/locations/europe-west1/reasoningEngines/2372156754508120064",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "aigovernance-gr6d",
              "updatedAt": "2026-06-24T23:47:57Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "StockBuddy",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b5c05032-f65e-57b3-a549-9a2e6af7b62c",
            "name": "aigovernance-gr6d",
            "cloudProvider": "GCP",
            "externalId": "aigovernance-gr6d",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "147d4ac3-3f84-5a94-b796-7acc89705432",
              "name": "CE-VC-DATAGOVERNANCE",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "15562a4f-affa-50bb-b1b9-e1b209d12855",
              "name": "provisioning-CE-VC-DATAGOVERNANCE",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-22T14:02:43.444506Z",
          "updatedAt": "2026-06-24T23:47:57.85102Z",
          "deletedAt": null,
          "firstSeen": "2026-06-22T19:56:09.365034Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "5b15e967-2fe8-5cdb-a6bf-5bc8d23456cc",
          "name": "dev-vc-self-training-supervisor-agent-test",
          "externalId": "projects/10916065558/locations/europe-west3/reasoningEngines/6656232288323371008",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "5b15e967-2fe8-5cdb-a6bf-5bc8d23456cc",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/10916065558/locations/europe-west3/reasoningEngines/6656232288323371008",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "5b15e967-2fe8-5cdb-a6bf-5bc8d23456cc",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west3/reasoning-engines/6656232288323371008?project=vc-self-training-nxky",
              "configPath": null,
              "creationDate": "2026-06-19T15:50:38.562214Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/10916065558/locations/europe-west3/reasoningEngines/6656232288323371008",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dev-vc-self-training-supervisor-agent-test",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/10916065558/locations/europe-west3/reasoningEngines/6656232288323371008",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west3",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "vc-self-training-nxky",
              "updatedAt": "2026-06-25T00:16:51Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dev-vc-self-training-supervisor-agent-test",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "862b73e6-2944-516b-91df-880a7dc05344",
            "name": "vc-self-training-nxky",
            "cloudProvider": "GCP",
            "externalId": "vc-self-training-nxky",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west3",
          "regionLocation": "DE",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-19T15:50:38.562214Z",
          "updatedAt": "2026-06-25T00:16:51.635545Z",
          "deletedAt": null,
          "firstSeen": "2026-06-20T00:30:49.718909Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "d4b7a294-8700-57e3-ba01-cc43ef8c85dd",
          "name": "Agent FCR to JSON Return",
          "externalId": "projects/787922697915/locations/us-west1/reasoningEngines/2742630600417476608",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "d4b7a294-8700-57e3-ba01-cc43ef8c85dd",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/787922697915/locations/us-west1/reasoningEngines/2742630600417476608",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "d4b7a294-8700-57e3-ba01-cc43ef8c85dd",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/2742630600417476608?project=shipperbox-yt2h",
              "configPath": null,
              "creationDate": "2026-06-19T14:59:25.69158Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/787922697915/locations/us-west1/reasoningEngines/2742630600417476608",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "Agent FCR to JSON Return",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/787922697915/locations/us-west1/reasoningEngines/2742630600417476608",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "shipperbox-yt2h",
              "updatedAt": "2026-06-25T00:03:07Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "Agent FCR to JSON Return",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "8cc292ad-4c44-51e0-a76c-7e923b745eb2",
            "name": "shipperbox",
            "cloudProvider": "GCP",
            "externalId": "shipperbox-yt2h",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-19T14:59:25.69158Z",
          "updatedAt": "2026-06-25T00:03:07.617705Z",
          "deletedAt": null,
          "firstSeen": "2026-06-20T00:14:18.095478Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "171ae7fd-31dd-53f1-bcce-9809986916f5",
          "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
          "externalId": "projects/787922697915/locations/us-west1/reasoningEngines/8421669730531672064",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "171ae7fd-31dd-53f1-bcce-9809986916f5",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/787922697915/locations/us-west1/reasoningEngines/8421669730531672064",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "171ae7fd-31dd-53f1-bcce-9809986916f5",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/8421669730531672064?project=shipperbox-yt2h",
              "configPath": null,
              "creationDate": "2026-06-19T14:48:58.885649Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/787922697915/locations/us-west1/reasoningEngines/8421669730531672064",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/787922697915/locations/us-west1/reasoningEngines/8421669730531672064",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "shipperbox-yt2h",
              "updatedAt": "2026-06-25T00:03:07Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "8cc292ad-4c44-51e0-a76c-7e923b745eb2",
            "name": "shipperbox",
            "cloudProvider": "GCP",
            "externalId": "shipperbox-yt2h",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f14a58e0-5a66-50e2-9603-3c5d8719b14e",
              "name": "shipperbox",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-19T14:48:58.885649Z",
          "updatedAt": "2026-06-25T00:03:07.598315Z",
          "deletedAt": null,
          "firstSeen": "2026-06-20T00:14:18.067125Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "edcb5db2-ca06-555c-800f-f35194b971d1",
          "name": "dev-vc-self-training-supervisor-agent",
          "externalId": "projects/10916065558/locations/europe-west3/reasoningEngines/3069115185122770944",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "edcb5db2-ca06-555c-800f-f35194b971d1",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/10916065558/locations/europe-west3/reasoningEngines/3069115185122770944",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "edcb5db2-ca06-555c-800f-f35194b971d1",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west3/reasoning-engines/3069115185122770944?project=vc-self-training-nxky",
              "configPath": null,
              "creationDate": "2026-06-17T21:47:47.76155Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/10916065558/locations/europe-west3/reasoningEngines/3069115185122770944",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dev-vc-self-training-supervisor-agent",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/10916065558/locations/europe-west3/reasoningEngines/3069115185122770944",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west3",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "vc-self-training-nxky",
              "updatedAt": "2026-06-25T00:16:51Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dev-vc-self-training-supervisor-agent",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "862b73e6-2944-516b-91df-880a7dc05344",
            "name": "vc-self-training-nxky",
            "cloudProvider": "GCP",
            "externalId": "vc-self-training-nxky",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west3",
          "regionLocation": "DE",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-17T21:47:47.76155Z",
          "updatedAt": "2026-06-25T00:16:51.654658Z",
          "deletedAt": null,
          "firstSeen": "2026-06-18T09:10:56.949595Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "19fadaa4-a098-5a2f-89ec-0a3294380b18",
          "name": "SAM",
          "externalId": "projects/551736195014/locations/us-west1/reasoningEngines/2631166509640056832",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "19fadaa4-a098-5a2f-89ec-0a3294380b18",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/551736195014/locations/us-west1/reasoningEngines/2631166509640056832",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "cb7008ef-86fb-5f19-b2db-229136330110",
                "e9b97fa6-34f0-5f53-a86d-9adb5f6be396"
              ],
              "_vertexID": "19fadaa4-a098-5a2f-89ec-0a3294380b18",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/2631166509640056832?project=supplier-onboarding-qqyk",
              "configPath": null,
              "creationDate": "2026-06-17T14:25:17.761282Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/551736195014/locations/us-west1/reasoningEngines/2631166509640056832",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "SAM",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/551736195014/locations/us-west1/reasoningEngines/2631166509640056832",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "supplier-onboarding-qqyk",
              "updatedAt": "2026-06-24T23:44:44Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "SAM",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "c9559cf2-3c80-5c98-899b-f5c58559f992",
            "name": "supplier-onboarding-qqyk",
            "cloudProvider": "GCP",
            "externalId": "supplier-onboarding-qqyk",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "cb7008ef-86fb-5f19-b2db-229136330110",
              "name": "CS-COMPONENT-MASTERY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e9b97fa6-34f0-5f53-a86d-9adb5f6be396",
              "name": "provisioning-CS-COMPONENT-MASTERY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-17T14:25:17.761282Z",
          "updatedAt": "2026-06-24T23:44:44.738736Z",
          "deletedAt": null,
          "firstSeen": "2026-06-17T20:23:47.200148Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "49d30a42-9221-5a5b-9cbb-cd78b4ce377f",
          "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
          "externalId": "projects/551736195014/locations/us-west1/reasoningEngines/5347400034897887232",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "49d30a42-9221-5a5b-9cbb-cd78b4ce377f",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/551736195014/locations/us-west1/reasoningEngines/5347400034897887232",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "cb7008ef-86fb-5f19-b2db-229136330110",
                "e9b97fa6-34f0-5f53-a86d-9adb5f6be396"
              ],
              "_vertexID": "49d30a42-9221-5a5b-9cbb-cd78b4ce377f",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/5347400034897887232?project=supplier-onboarding-qqyk",
              "configPath": null,
              "creationDate": "2026-06-16T11:57:51.135157Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/551736195014/locations/us-west1/reasoningEngines/5347400034897887232",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/551736195014/locations/us-west1/reasoningEngines/5347400034897887232",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "supplier-onboarding-qqyk",
              "updatedAt": "2026-06-24T23:44:44Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "c9559cf2-3c80-5c98-899b-f5c58559f992",
            "name": "supplier-onboarding-qqyk",
            "cloudProvider": "GCP",
            "externalId": "supplier-onboarding-qqyk",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "cb7008ef-86fb-5f19-b2db-229136330110",
              "name": "CS-COMPONENT-MASTERY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e9b97fa6-34f0-5f53-a86d-9adb5f6be396",
              "name": "provisioning-CS-COMPONENT-MASTERY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-16T11:57:51.135157Z",
          "updatedAt": "2026-06-24T23:44:44.73219Z",
          "deletedAt": null,
          "firstSeen": "2026-06-16T16:20:52.200623Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "f3b1463b-5d87-549e-b7d3-58958766a3f4",
          "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
          "externalId": "projects/244033477051/locations/us-west1/reasoningEngines/487171612034990080",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "f3b1463b-5d87-549e-b7d3-58958766a3f4",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/244033477051/locations/us-west1/reasoningEngines/487171612034990080",
            "properties": {
              "_productIDs": [
                "0cec7b1b-9b5a-564f-b29d-dd7eb1a9b723",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "3d089b5c-97f9-58b9-ac91-25f32e0e9a60"
              ],
              "_vertexID": "f3b1463b-5d87-549e-b7d3-58958766a3f4",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/487171612034990080?project=automationsyp-8il5",
              "configPath": null,
              "creationDate": "2026-06-12T07:10:46.629964Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/244033477051/locations/us-west1/reasoningEngines/487171612034990080",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/244033477051/locations/us-west1/reasoningEngines/487171612034990080",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "automationsyp-8il5",
              "updatedAt": "2026-06-24T23:15:17Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "5f6dd388-26ce-5e0b-bcac-1a985d42e4ca",
            "name": "automationsyp-8il5",
            "cloudProvider": "GCP",
            "externalId": "automationsyp-8il5",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "0cec7b1b-9b5a-564f-b29d-dd7eb1a9b723",
              "name": "CE-SYP",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "3d089b5c-97f9-58b9-ac91-25f32e0e9a60",
              "name": "provisioning-CE-SYP",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-12T07:10:46.629964Z",
          "updatedAt": "2026-06-24T23:15:17.02066Z",
          "deletedAt": null,
          "firstSeen": "2026-06-12T20:25:42.570986Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "7323c5a5-9b93-5c2e-9d36-28ee1629e1b1",
          "name": "dpm-agent",
          "externalId": "projects/651748649412/locations/europe-west1/reasoningEngines/1138592669073670144",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "7323c5a5-9b93-5c2e-9d36-28ee1629e1b1",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/651748649412/locations/europe-west1/reasoningEngines/1138592669073670144",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "7323c5a5-9b93-5c2e-9d36-28ee1629e1b1",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/1138592669073670144?project=industry-srm-j5yl",
              "configPath": null,
              "creationDate": "2026-06-04T13:10:39.889539Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/651748649412/locations/europe-west1/reasoningEngines/1138592669073670144",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dpm-agent",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/651748649412/locations/europe-west1/reasoningEngines/1138592669073670144",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "industry-srm-j5yl",
              "updatedAt": "2026-06-25T00:17:17Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dpm-agent",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "3c7b95bf-4651-588a-b540-a35bc3c26845",
            "name": "industry-srm-j5yl",
            "cloudProvider": "GCP",
            "externalId": "industry-srm-j5yl",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-04T13:10:39.889539Z",
          "updatedAt": "2026-06-25T00:17:17.046005Z",
          "deletedAt": null,
          "firstSeen": "2026-06-04T20:10:00.534047Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "04b6d981-da0a-5ec1-91fd-b12626660cdd",
          "name": "datacost-agent",
          "externalId": "projects/651748649412/locations/europe-west1/reasoningEngines/7479660944411328512",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "04b6d981-da0a-5ec1-91fd-b12626660cdd",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/651748649412/locations/europe-west1/reasoningEngines/7479660944411328512",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "04b6d981-da0a-5ec1-91fd-b12626660cdd",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/7479660944411328512?project=industry-srm-j5yl",
              "configPath": null,
              "creationDate": "2026-06-04T10:50:59.096391Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/651748649412/locations/europe-west1/reasoningEngines/7479660944411328512",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "datacost-agent",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/651748649412/locations/europe-west1/reasoningEngines/7479660944411328512",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "industry-srm-j5yl",
              "updatedAt": "2026-06-25T00:17:17Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "datacost-agent",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "3c7b95bf-4651-588a-b540-a35bc3c26845",
            "name": "industry-srm-j5yl",
            "cloudProvider": "GCP",
            "externalId": "industry-srm-j5yl",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-06-04T10:50:59.096391Z",
          "updatedAt": "2026-06-25T00:17:17.035983Z",
          "deletedAt": null,
          "firstSeen": "2026-06-04T20:10:00.524298Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "ee784f60-2532-5e0b-b8ed-7aaf5ca4b7c0",
          "name": "agents",
          "externalId": "CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##mysupply-g-v9h4/mysupply-docker/mysupply-agent@sha256:1be3eb9964b58c976c4f4add5ee3eaf04bdf97c694221ab550e784c5bbe8ac9d##/app/src/agents",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "ee784f60-2532-5e0b-b8ed-7aaf5ca4b7c0",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "ee784f60-2532-5e0b-b8ed-7aaf5ca4b7c0",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app/src/agents",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##mysupply-g-v9h4/mysupply-docker/mysupply-agent@sha256:1be3eb9964b58c976c4f4add5ee3eaf04bdf97c694221ab550e784c5bbe8ac9d##/app/src/agents",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "agents",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": "from ag_ui_adk.agui_toolset import AGUIToolset\\nfrom dotenv import load_dotenv\\nfrom google.adk.agents.llm_agent import Agent, FunctionTool\\n\\nfrom src.agents.callbacks.before_model.apply_armor_guardrail import apply_armor_guardrail\\nfrom src.agents.tools.create_a_smax_ticket import create_a_smax_ticket\\nfrom src.agents.tools.get_can_edit_pcon_rules import get_can_edit_pcon_rules\\nfrom src.agents.tools.get_user_information import get_user_information\\nfrom src.agents.utils import build_static_instruction\\nfrom src.configs.config import ---REDACTED---()\\n\\ndef inject_state_in_instruction():\\n    return Config.AGENT_INSTRUCTION + \"\"\"\\n    ====== AG-UI Context ======\\n        {_ag_ui_context?}\\n    ====== End of AG-UI Context ======\\n    \"\"\"\\n\\n\\nadk_agent = Agent(\\n    model='gemini-2.5-flash',\\n    name='mysupply_ai_bot',\\n    description='MySupply agent to help and guide users',\\n    static_instruction=build_static_instruction(docs_dir=Config.AGENT_DOCS_DIR, google_drive_folder_id=Config.GOOGLE_DRIVE_FOLDER_ID, google_service_account_json_path=Config.GOOGLE_SERVICE_ACCOUNT_JSON_PATH),\\n    instruction=inject_state_in_instruction(),\\n    before_model_callback=[apply_armor_guardrail],\\n    tools=[AGUIToolset(),\\n           FunctionTool(get_user_information),\\n           FunctionTool(get_can_edit_pcon_rules),\\n           FunctionTool(create_a_smax_ticket, require_confirmation=True)])\\n",
              "status": "Active",
              "subscriptionExternalId": "inix-horsprod-n0wq",
              "updatedAt": "2026-07-07T18:05:10Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "agents",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc",
            "name": "inix-horsprod-n0wq",
            "cloudProvider": "GCP",
            "externalId": "inix-horsprod-n0wq",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-07T18:05:10.071733Z",
          "deletedAt": null,
          "firstSeen": "2026-05-27T03:34:23.819983Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "d4bca94b-ec43-5305-b583-577adc67e5ce",
          "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
          "externalId": "projects/10916065558/locations/us-west1/reasoningEngines/2711246140514238464",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "d4bca94b-ec43-5305-b583-577adc67e5ce",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/10916065558/locations/us-west1/reasoningEngines/2711246140514238464",
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "d4bca94b-ec43-5305-b583-577adc67e5ce",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/2711246140514238464?project=vc-self-training-nxky",
              "configPath": null,
              "creationDate": "2026-05-26T13:33:55.841453Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/10916065558/locations/us-west1/reasoningEngines/2711246140514238464",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/10916065558/locations/us-west1/reasoningEngines/2711246140514238464",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "vc-self-training-nxky",
              "updatedAt": "2026-06-25T00:16:52Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "AGENT_DESIGNER_GENERATED_DO_NOT_DELETE",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "862b73e6-2944-516b-91df-880a7dc05344",
            "name": "vc-self-training-nxky",
            "cloudProvider": "GCP",
            "externalId": "vc-self-training-nxky",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-26T13:33:55.841453Z",
          "updatedAt": "2026-06-25T00:16:52.495341Z",
          "deletedAt": null,
          "firstSeen": "2026-05-26T14:44:25.356468Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "ad022bce-69c9-599a-9b0a-4b08ac1b693f",
          "name": "dev-sc-self-analytics-supervisor-agent",
          "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/4702910299160707072",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "ad022bce-69c9-599a-9b0a-4b08ac1b693f",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/4702910299160707072",
            "properties": {
              "_productIDs": [
                "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "295fbc80-2563-5f6a-8ced-88fe9761ef95"
              ],
              "_vertexID": "ad022bce-69c9-599a-9b0a-4b08ac1b693f",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/4702910299160707072?project=tst4-slf-analytics-zouu",
              "configPath": null,
              "creationDate": "2026-05-24T22:01:35.521041Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/4702910299160707072",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dev-sc-self-analytics-supervisor-agent",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/4702910299160707072",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "tst4-slf-analytics-zouu",
              "updatedAt": "2026-06-25T00:17:50Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dev-sc-self-analytics-supervisor-agent",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b8871f3a-312f-5245-9dd5-77f4ebc17464",
            "name": "tst4-slf-analytics-zouu",
            "cloudProvider": "GCP",
            "externalId": "tst4-slf-analytics-zouu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
              "name": "provisioning-CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "295fbc80-2563-5f6a-8ced-88fe9761ef95",
              "name": "CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-24T22:01:35.521041Z",
          "updatedAt": "2026-06-25T00:17:50.151805Z",
          "deletedAt": null,
          "firstSeen": "2026-05-25T01:01:13.142462Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "6c68ec60-8dd7-5dd8-a12d-7c5b087f1c29",
          "name": "Gemini CLI",
          "externalId": "CloudPlatform/VirtualMachine##8227624179727511308##Gemini CLI##NPM",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "6c68ec60-8dd7-5dd8-a12d-7c5b087f1c29",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "c4c815fb-70d0-5107-9d25-e5f17c889251",
                "e585c9d1-1723-5c9e-bbdc-47b0258c58aa"
              ],
              "_vertexID": "6c68ec60-8dd7-5dd8-a12d-7c5b087f1c29",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/usr/local/lib/node_modules/@google/gemini-cli/README.md",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": "/usr/local/bin/gemini",
              "externalId": "CloudPlatform/VirtualMachine##8227624179727511308##Gemini CLI##NPM",
              "fullResourceName": null,
              "installationMethod": "NPM",
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "Gemini CLI",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Google",
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Inactive",
              "subscriptionExternalId": "sap-nonprod-xk4u",
              "updatedAt": "2026-07-07T03:54:15Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "Gemini CLI",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "0667c757-490c-5dda-94cf-84d99cc3cbe1",
            "name": "sap-nonprod",
            "cloudProvider": "GCP",
            "externalId": "sap-nonprod-xk4u",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Inactive",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "provisioning-CS-INFRA-HIGHWAY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-07T03:54:15.370609Z",
          "deletedAt": null,
          "firstSeen": "2026-05-22T10:30:25.771469Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "36341fba-70e0-5191-a266-df086d644148",
          "name": "Gemini CLI",
          "externalId": "CloudPlatform/VirtualMachine##8989096712799956790##Gemini CLI##NPM",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "36341fba-70e0-5191-a266-df086d644148",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "c4c815fb-70d0-5107-9d25-e5f17c889251",
                "e585c9d1-1723-5c9e-bbdc-47b0258c58aa"
              ],
              "_vertexID": "36341fba-70e0-5191-a266-df086d644148",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/usr/local/lib/node_modules/@google/gemini-cli/LICENSE",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": "/usr/local/bin/gemini",
              "externalId": "CloudPlatform/VirtualMachine##8989096712799956790##Gemini CLI##NPM",
              "fullResourceName": null,
              "installationMethod": "NPM",
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "Gemini CLI",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Google",
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Inactive",
              "subscriptionExternalId": "sap-nonprod-xk4u",
              "updatedAt": "2026-07-06T00:49:44Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "Gemini CLI",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "0667c757-490c-5dda-94cf-84d99cc3cbe1",
            "name": "sap-nonprod",
            "cloudProvider": "GCP",
            "externalId": "sap-nonprod-xk4u",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Inactive",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "provisioning-CS-INFRA-HIGHWAY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-06T00:49:44.367986Z",
          "deletedAt": null,
          "firstSeen": "2026-05-22T10:17:44.386986Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "47dc9495-0da8-58bb-9352-102db6dd1797",
          "name": "Gemini CLI",
          "externalId": "CloudPlatform/VirtualMachine##1290899538786299701##Gemini CLI##NPM",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "47dc9495-0da8-58bb-9352-102db6dd1797",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "c4c815fb-70d0-5107-9d25-e5f17c889251",
                "e585c9d1-1723-5c9e-bbdc-47b0258c58aa"
              ],
              "_vertexID": "47dc9495-0da8-58bb-9352-102db6dd1797",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/usr/local/lib/node_modules/@google/gemini-cli/README.md",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": "/usr/local/bin/gemini",
              "externalId": "CloudPlatform/VirtualMachine##1290899538786299701##Gemini CLI##NPM",
              "fullResourceName": null,
              "installationMethod": "NPM",
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "Gemini CLI",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Google",
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Inactive",
              "subscriptionExternalId": "sap-nonprod-xk4u",
              "updatedAt": "2026-07-07T04:08:28Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "Gemini CLI",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "0667c757-490c-5dda-94cf-84d99cc3cbe1",
            "name": "sap-nonprod",
            "cloudProvider": "GCP",
            "externalId": "sap-nonprod-xk4u",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Inactive",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "provisioning-CS-INFRA-HIGHWAY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-07T04:08:28.504659Z",
          "deletedAt": null,
          "firstSeen": "2026-05-22T10:02:50.315064Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "0e7284a1-b9a2-53bb-9bab-bd40218541cc",
          "name": "Gemini CLI",
          "externalId": "CloudPlatform/VirtualMachine##5302466575459776248##Gemini CLI##NPM",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "0e7284a1-b9a2-53bb-9bab-bd40218541cc",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "c4c815fb-70d0-5107-9d25-e5f17c889251",
                "e585c9d1-1723-5c9e-bbdc-47b0258c58aa"
              ],
              "_vertexID": "0e7284a1-b9a2-53bb-9bab-bd40218541cc",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/usr/local/lib/node_modules/@google/gemini-cli/LICENSE",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": "/usr/local/bin/gemini",
              "externalId": "CloudPlatform/VirtualMachine##5302466575459776248##Gemini CLI##NPM",
              "fullResourceName": null,
              "installationMethod": "NPM",
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "Gemini CLI",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Google",
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Inactive",
              "subscriptionExternalId": "sap-nonprod-xk4u",
              "updatedAt": "2026-07-07T03:46:57Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "Gemini CLI",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "0667c757-490c-5dda-94cf-84d99cc3cbe1",
            "name": "sap-nonprod",
            "cloudProvider": "GCP",
            "externalId": "sap-nonprod-xk4u",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Inactive",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "c4c815fb-70d0-5107-9d25-e5f17c889251",
              "name": "CS-INFRA-HIGHWAY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "e585c9d1-1723-5c9e-bbdc-47b0258c58aa",
              "name": "provisioning-CS-INFRA-HIGHWAY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-07T03:46:57.205105Z",
          "deletedAt": null,
          "firstSeen": "2026-05-22T09:48:35.763144Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "c596fd76-a832-54b1-a216-f3c322338778",
          "name": "inix-agent-run",
          "externalId": "projects/inix-horsprod-n0wq/locations/europe-west4/services/inix-agent/revisions/inix-agent-00020-gwq##CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##inix-vctech-0alr/inix-apps/agent-inix@sha256:b5ebb4594670b7916ff3633d0a197bc7f357e53d4afbad57124cd0a4026f4fb1##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "c596fd76-a832-54b1-a216-f3c322338778",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "c596fd76-a832-54b1-a216-f3c322338778",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "projects/inix-horsprod-n0wq/locations/europe-west4/services/inix-agent/revisions/inix-agent-00020-gwq##CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##inix-vctech-0alr/inix-apps/agent-inix@sha256:b5ebb4594670b7916ff3633d0a197bc7f357e53d4afbad57124cd0a4026f4fb1##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "inix-agent-run",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": "\\n---\\n\\n### Monthly and Yearly Statistics\\n- **list-total-incidents-by-year-by-month**  \\n  Provides the total number of incidents per month for a given year.\\n\\n- **list-total-incidents-by-year-by-month-by-category**  \\n  Provides monthly totals per category for a given year.\\n\\n- **list-total-incidents-by-server-by-year**  \\n  Returns the monthly incident counts for a specific server during a given year.\\n\\n- **list-monthly-incidents-by-server-pattern-by-year**  \\n  Returns monthly incident totals for all servers matching a given hostname pattern.\\n\\n---\\n\\n### Automation & Monitoring\\n- **list-incidents-vigilance-by-week-automated-by-month**  \\n  Lists incidents automatically handled by “ZZZ_Interface” (Volume-related) aggregated per week.\\n\\n---\\n\\n### Mean Time To Resolution (MTTR) Analysis\\nAll MTTR-related tools use **business hours** only (Mon–Fri, 09:00–18:00).\\n\\n- **calculate-global-mttr-by-month**  \\n  Returns the global MTTR (all incidents) and total count for a given month.\\n\\n- **calculate-mttr-by-category-by-month**  \\n  Returns MTTR and incident count per category for a given month.\\n\\n- **calculate-mttr-by-server-pattern-by-year**  \\n  Returns monthly MTTR for a specific server or hostname pattern for a given year.\\n\\n- **calculate-top-mttr-assets-by-month**  \\n  Returns the Top X assets with the highest MTTR for a given month.\\n\\n- **calculate-global-mttr-evolution-by-year**  \\n  Returns the monthly evolution of global MTTR and total incident count for a given year.\\n\\n---\\n\\n## Agent Responsibilities\\n\\nYou must:\\n1. Detect and report recurring or abnormal incident patterns (by type, component, or server).  \\n2. Compute and analyze MTTR (Mean Time To Resolution) in working hours only.  \\n3. Provide visibility on incident volumes and trends by month, year, and category.  \\n4. Identify automation efficiency (incidents handled by ZZZ_Interface).  \\n5. Compare performance across months, servers, or categories.  \\n6. Highlight outliers (servers or assets with the highest MTTR).  \\n7. Support root-cause and deep-dive investigations when requested.\\n\\n---\\n\\n## Output & Behavior Rules\\n\\nWhen a user asks a question:\\n- Execute the corresponding SQL tool ---REDACTED---(no confirmation required).  \\n- If the month or year is not provided, default to the current one.  \\n- Always format results as **Markdown tables**.  \\n- Round numeric values to **two decimals**.  \\n- Keep responses concise, factual, and actionable.  \\n\\nWhen relevant, highlight:\\n- MTTR evolution (increase/decrease)  \\n- The most affected categories or assets  \\n- Any correlation between incident frequency and MTTR  \\n\\n---\\n\\n## Example Queries You Can Handle\\n\\n- What is the MTTR by category for September 2025?  \\n- Give me the global MTTR for September 2025.  \\n- Show me the evolution of MTTR month by month for 2025.  \\n- Show me the Top 5 assets with the highest MTTR this month.  \\n- Compare MTTR for prodh1flw65 during 2025.  \\n- List recurring Datadog incidents for August 2025.  \\n- How many incidents were handled automatically by ZZZ_Interface last month?  \\n\\n---\\n\\nAlways base your answers on factual SQL data.  \\nNever assume or extrapolate missing data.  \\nUse a professional, analytical tone focused on reliability insights.\\n\"\"\"\\n\\ndef format_results(rows, columns):\\n    \"\"\"\\n    Formate un résultat SQL (rows + columns) en tableau Markdown générique.\\n    Fonctionne avec liste de tuples ou liste de dictionnaires.\\n    \"\"\"\\n    if not rows:\\n        return \"Aucun résultat trouvé.\"\\n\\n    header = \"| \" + \" | \".join(columns) + \" |\"\\n    separator = \"| \" + \" | \".join([\"-\" * len(col) for col in columns]) + \" |\"\\n\\n    lines = [header, separator]\\n\\n    for row in rows:\\n        if isinstance(row, dict):\\n            values = [str(row.get(col, \"\")) for col in columns]\\n        else:\\n            values = [str(value) for value in row]\\n        lines.append(\"| \" + \" | \".join(values) + \" |\")\\n\\n    return \"\\n\".join(lines)\\n\\n\\nasync def agent_init():\\n    global _runner, _session_service, _artifacts_service, _toolbox, _session_id\\n\\n    # Charger les infos du .env\\n    project_id = os.getenv(\"GOOGLE_CLOUD_PROJECT\")\\n    location = os.getenv(\"GOOGLE_CLOUD_LOCATION\", \"us-central1\")\\n    credentials_path = os.getenv(\"GOOGLE_APPLICATION_CREDENTIALS\")\\n\\n    if not project_id:\\n        raise RuntimeError(\"❌ Variable GOOGLE_CLOUD_PROJECT manquante dans .env\")\\n\\n    if not credentials_path or not os.path.isfile(credentials_path):\\n        raise RuntimeError(\"❌ Clé JSON introuvable : GOOGLE_APPLICATION_CREDENTIALS\")\\n\\n    # Charger les credentials du service account\\n    credentials = service_account.Credentials.from_service_account_file(credentials_path)\\n\\n    # Initialiser Vertex AI avec le service account\\n    aiplatform.init(\\n        project=project_id,\\n        location=location,\\n        credentials=credentials,\\n    )\\n\\n    toolbox_url = os.getenv(\"TOOLBOX_URL\", \"http://127.0.0.1:5000\")\\n    toolset_name = os.getenv(\"TOOLSET_NAME\", \"my-toolset\")\\n    model = os.getenv(\"MODEL\", \"gemini-2.0-flash-001\")\\n\\n    _session_service = InMemorySessionService()\\n    _artifacts_service = InMemoryArtifactService()\\n    _toolbox = ToolboxSyncClient(toolbox_url)\\n\\n    root_agent = Agent(\\n        model=model,\\n        name=\"agent_inix\",\\n        description=\"An AI sysadmin agent specialized in incident analysis: recurring issues, SLA/SLO/SLI metrics, compliance breaches, and operator performance insights.\",\\n        instruction=PROMPT,\\n        tools=_toolbox.load_toolset(toolset_name),\\n    )\\n\\n    session = await _session_service.create_session(\\n        state={}, app_name=\"agent_inix\", user_id=---REDACTED---)\\n    _session_id = session.id\\n\\n    _runner = Runner(\\n        app_name=\"agent_inix\",\\n        agent=root_agent,\\n        artifact_service=_artifacts_service,\\n        session_service=_session_service,\\n    )\\n\\n\\nasync def agent_run(query: str) -> str:\\n    if not _runner or not _session_id:\\n        raise RuntimeError(\"Agent not initialized. Call agent_init() first.\")\\n\\n    content = genai_types.Content(role=\"user\", parts=[genai_types.Part(text=query)])\\n    events = _runner.run(session_id=_session_id, user_id=---REDACTED---, new_message=content)\\n\\n    responses: List[str] = []\\n    for event in events:\\n        if getattr(event, \"content\", None):\\n            for part in getattr(event.content, \"parts\", []) or []:\\n                if getattr(part, \"text\", None):\\n                    responses.append(part.text)\\n\\n    # Si la réponse contient déjà un tableau Markdown, on la renvoie telle quelle\\n    final_reply = \"\\n\".join(responses).strip()\\n    if final_reply.startswith(\"|\") and \"\\n|\" in final_reply:\\n        return final_reply\\n\\n    return final_reply\\n\\n\\ndef agent_close():\\n    global _toolbox\\n    if _toolbox:\\n        try:\\n            _toolbox.close()\\n        except Exception:\\n            pass\\n        _toolbox =---REDACTED---",
              "status": "Active",
              "subscriptionExternalId": "inix-horsprod-n0wq",
              "updatedAt": "2026-07-05T11:35:36Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "inix-agent-run",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f391b2ee-ffdf-58e1-a3af-a59bfeaba3dc",
            "name": "inix-horsprod-n0wq",
            "cloudProvider": "GCP",
            "externalId": "inix-horsprod-n0wq",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T11:35:36.306986Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T21:18:59.493792Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "0390f24c-ec5c-5e0e-9104-b4f760fa8511",
          "name": "inix-agent-run",
          "externalId": "CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##inix-vctech-0alr/inix-apps/agent-inix@sha256:b5ebb4594670b7916ff3633d0a197bc7f357e53d4afbad57124cd0a4026f4fb1##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "0390f24c-ec5c-5e0e-9104-b4f760fa8511",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "063257c7-d728-53fd-b7a1-31d7fcd3b339",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "f2ee46a1-4afa-5eab-b550-ef9c5a07021d"
              ],
              "_vertexID": "0390f24c-ec5c-5e0e-9104-b4f760fa8511",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##europe-west4-docker.pkg.dev##inix-vctech-0alr/inix-apps/agent-inix@sha256:b5ebb4594670b7916ff3633d0a197bc7f357e53d4afbad57124cd0a4026f4fb1##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "inix-agent-run",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "europe-west4",
              "resourceGroupExternalId": null,
              "snippet": "\\n---\\n\\n### Monthly and Yearly Statistics\\n- **list-total-incidents-by-year-by-month**  \\n  Provides the total number of incidents per month for a given year.\\n\\n- **list-total-incidents-by-year-by-month-by-category**  \\n  Provides monthly totals per category for a given year.\\n\\n- **list-total-incidents-by-server-by-year**  \\n  Returns the monthly incident counts for a specific server during a given year.\\n\\n- **list-monthly-incidents-by-server-pattern-by-year**  \\n  Returns monthly incident totals for all servers matching a given hostname pattern.\\n\\n---\\n\\n### Automation & Monitoring\\n- **list-incidents-vigilance-by-week-automated-by-month**  \\n  Lists incidents automatically handled by “ZZZ_Interface” (Volume-related) aggregated per week.\\n\\n---\\n\\n### Mean Time To Resolution (MTTR) Analysis\\nAll MTTR-related tools use **business hours** only (Mon–Fri, 09:00–18:00).\\n\\n- **calculate-global-mttr-by-month**  \\n  Returns the global MTTR (all incidents) and total count for a given month.\\n\\n- **calculate-mttr-by-category-by-month**  \\n  Returns MTTR and incident count per category for a given month.\\n\\n- **calculate-mttr-by-server-pattern-by-year**  \\n  Returns monthly MTTR for a specific server or hostname pattern for a given year.\\n\\n- **calculate-top-mttr-assets-by-month**  \\n  Returns the Top X assets with the highest MTTR for a given month.\\n\\n- **calculate-global-mttr-evolution-by-year**  \\n  Returns the monthly evolution of global MTTR and total incident count for a given year.\\n\\n---\\n\\n## Agent Responsibilities\\n\\nYou must:\\n1. Detect and report recurring or abnormal incident patterns (by type, component, or server).  \\n2. Compute and analyze MTTR (Mean Time To Resolution) in working hours only.  \\n3. Provide visibility on incident volumes and trends by month, year, and category.  \\n4. Identify automation efficiency (incidents handled by ZZZ_Interface).  \\n5. Compare performance across months, servers, or categories.  \\n6. Highlight outliers (servers or assets with the highest MTTR).  \\n7. Support root-cause and deep-dive investigations when requested.\\n\\n---\\n\\n## Output & Behavior Rules\\n\\nWhen a user asks a question:\\n- Execute the corresponding SQL tool ---REDACTED---(no confirmation required).  \\n- If the month or year is not provided, default to the current one.  \\n- Always format results as **Markdown tables**.  \\n- Round numeric values to **two decimals**.  \\n- Keep responses concise, factual, and actionable.  \\n\\nWhen relevant, highlight:\\n- MTTR evolution (increase/decrease)  \\n- The most affected categories or assets  \\n- Any correlation between incident frequency and MTTR  \\n\\n---\\n\\n## Example Queries You Can Handle\\n\\n- What is the MTTR by category for September 2025?  \\n- Give me the global MTTR for September 2025.  \\n- Show me the evolution of MTTR month by month for 2025.  \\n- Show me the Top 5 assets with the highest MTTR this month.  \\n- Compare MTTR for prodh1flw65 during 2025.  \\n- List recurring Datadog incidents for August 2025.  \\n- How many incidents were handled automatically by ZZZ_Interface last month?  \\n\\n---\\n\\nAlways base your answers on factual SQL data.  \\nNever assume or extrapolate missing data.  \\nUse a professional, analytical tone focused on reliability insights.\\n\"\"\"\\n\\ndef format_results(rows, columns):\\n    \"\"\"\\n    Formate un résultat SQL (rows + columns) en tableau Markdown générique.\\n    Fonctionne avec liste de tuples ou liste de dictionnaires.\\n    \"\"\"\\n    if not rows:\\n        return \"Aucun résultat trouvé.\"\\n\\n    header = \"| \" + \" | \".join(columns) + \" |\"\\n    separator = \"| \" + \" | \".join([\"-\" * len(col) for col in columns]) + \" |\"\\n\\n    lines = [header, separator]\\n\\n    for row in rows:\\n        if isinstance(row, dict):\\n            values = [str(row.get(col, \"\")) for col in columns]\\n        else:\\n            values = [str(value) for value in row]\\n        lines.append(\"| \" + \" | \".join(values) + \" |\")\\n\\n    return \"\\n\".join(lines)\\n\\n\\nasync def agent_init():\\n    global _runner, _session_service, _artifacts_service, _toolbox, _session_id\\n\\n    # Charger les infos du .env\\n    project_id = os.getenv(\"GOOGLE_CLOUD_PROJECT\")\\n    location = os.getenv(\"GOOGLE_CLOUD_LOCATION\", \"us-central1\")\\n    credentials_path = os.getenv(\"GOOGLE_APPLICATION_CREDENTIALS\")\\n\\n    if not project_id:\\n        raise RuntimeError(\"❌ Variable GOOGLE_CLOUD_PROJECT manquante dans .env\")\\n\\n    if not credentials_path or not os.path.isfile(credentials_path):\\n        raise RuntimeError(\"❌ Clé JSON introuvable : GOOGLE_APPLICATION_CREDENTIALS\")\\n\\n    # Charger les credentials du service account\\n    credentials = service_account.Credentials.from_service_account_file(credentials_path)\\n\\n    # Initialiser Vertex AI avec le service account\\n    aiplatform.init(\\n        project=project_id,\\n        location=location,\\n        credentials=credentials,\\n    )\\n\\n    toolbox_url = os.getenv(\"TOOLBOX_URL\", \"http://127.0.0.1:5000\")\\n    toolset_name = os.getenv(\"TOOLSET_NAME\", \"my-toolset\")\\n    model = os.getenv(\"MODEL\", \"gemini-2.0-flash-001\")\\n\\n    _session_service = InMemorySessionService()\\n    _artifacts_service = InMemoryArtifactService()\\n    _toolbox = ToolboxSyncClient(toolbox_url)\\n\\n    root_agent = Agent(\\n        model=model,\\n        name=\"agent_inix\",\\n        description=\"An AI sysadmin agent specialized in incident analysis: recurring issues, SLA/SLO/SLI metrics, compliance breaches, and operator performance insights.\",\\n        instruction=PROMPT,\\n        tools=_toolbox.load_toolset(toolset_name),\\n    )\\n\\n    session = await _session_service.create_session(\\n        state={}, app_name=\"agent_inix\", user_id=---REDACTED---)\\n    _session_id = session.id\\n\\n    _runner = Runner(\\n        app_name=\"agent_inix\",\\n        agent=root_agent,\\n        artifact_service=_artifacts_service,\\n        session_service=_session_service,\\n    )\\n\\n\\nasync def agent_run(query: str) -> str:\\n    if not _runner or not _session_id:\\n        raise RuntimeError(\"Agent not initialized. Call agent_init() first.\")\\n\\n    content = genai_types.Content(role=\"user\", parts=[genai_types.Part(text=query)])\\n    events = _runner.run(session_id=_session_id, user_id=---REDACTED---, new_message=content)\\n\\n    responses: List[str] = []\\n    for event in events:\\n        if getattr(event, \"content\", None):\\n            for part in getattr(event.content, \"parts\", []) or []:\\n                if getattr(part, \"text\", None):\\n                    responses.append(part.text)\\n\\n    # Si la réponse contient déjà un tableau Markdown, on la renvoie telle quelle\\n    final_reply = \"\\n\".join(responses).strip()\\n    if final_reply.startswith(\"|\") and \"\\n|\" in final_reply:\\n        return final_reply\\n\\n    return final_reply\\n\\n\\ndef agent_close():\\n    global _toolbox\\n    if _toolbox:\\n        try:\\n            _toolbox.close()\\n        except Exception:\\n            pass\\n        _toolbox =---REDACTED---",
              "status": "Active",
              "subscriptionExternalId": "inix-vctech-0alr",
              "updatedAt": "2026-07-05T11:35:32Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "inix-agent-run",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "86a11580-2086-56a7-88d2-27f405958fcb",
            "name": "INIX-VCTECH",
            "cloudProvider": "GCP",
            "externalId": "inix-vctech-0alr",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west4",
          "regionLocation": "NL",
          "tags": null,
          "projects": [
            {
              "id": "063257c7-d728-53fd-b7a1-31d7fcd3b339",
              "name": "CS-TETRIX",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "f2ee46a1-4afa-5eab-b550-ef9c5a07021d",
              "name": "provisioning-CS-TETRIX",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T11:35:32.45039Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T21:18:56.467571Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "49366711-de64-5f41-b14e-22ce4de4f0a9",
          "name": "dps-chatcr",
          "externalId": "projects/sports-lab-ry1w/locations/europe-west1/services/chatbot-techoff-dsl/revisions/chatbot-techoff-dsl-00201-9gq##CloudPlatform/ContainerImage##gcr.io/sports-lab-ry1w##chatbot-techoff-dsl@sha256:2227662e8b5a917c313fc4dbf8401832798de10851b72a21294fe344fe10a154##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "49366711-de64-5f41-b14e-22ce4de4f0a9",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "06d5c447-679e-5cb1-a8b1-5ad5b831f898",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "95978ca8-e7cc-5db5-991d-38a103145065"
              ],
              "_vertexID": "49366711-de64-5f41-b14e-22ce4de4f0a9",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "projects/sports-lab-ry1w/locations/europe-west1/services/chatbot-techoff-dsl/revisions/chatbot-techoff-dsl-00201-9gq##CloudPlatform/ContainerImage##gcr.io/sports-lab-ry1w##chatbot-techoff-dsl@sha256:2227662e8b5a917c313fc4dbf8401832798de10851b72a21294fe344fe10a154##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dps-chatcr",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Decathlon Digital Team",
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": "from langchain_google_community import VertexAISearchRetriever\\nfrom langchain_google_vertexai import ChatVertexAI\\nfrom langgraph.graph import END, StateGraph\\nfrom langgraph.graph.message import add_messages\\n\\nfrom app.memory_manager import FirestoreMemoryManager\\nfrom app.models.llm_outputs import AnalysisDecisionModel, SQLGenerationModel\\nfrom app.tools.text_to_sql import TextToSql\\nfrom app.utils.extract_datastore_infos import parse_data_store_path\\n\\n# Configure logging\\nlogger = logging.getLogger(__name__)\\n\\n\\n# Define state for the graph\\nclass ChatbotState(TypedDict):\\n    \"\"\"State that flows through the reasoning chain.\"\"\"\\n\\n    messages: Annotated[List[BaseMessage], add_messages]\\n    enrichment_context: str  # Context from RAG/Search\\n    analysis_decision: Dict  # Decision about SQL usage and filters\\n    sql_results: Dict  # Results from SQL execution\\n    sources: Dict[str, str]  # Source citations\\n    conversation_id: str\\n\\n\\nclass Chatbot:\\n    \"\"\"\\n    A chatbot implementation using Google's Vertex AI Gemini model + Retrieval\\n    tool (RAG).\\n\\n    Attributes:\\n---REDACTED---  client (genai.Client): The initialized GenAI client\\n---REDACTED---  model (str): The Gemini model name\\n---REDACTED---  system_prompt (str): The system prompt that defines the\\n---REDACTED---  chatbot's behavior\\n---REDACTED---  tools (list): List of tools available (RAG datastore etc.)\\n    \"\"\"\\n\\n    def __init__(self) -> None:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Initialize the chatbot with GenAI client and RAG setup.\\n\\n---REDACTED---  Required environment variables:\\n---REDACTED------REDACTED---GOOGLE_PROJECT_ID: The Google Cloud project ID\\n---REDACTED------REDACTED---GEMINI_LOCATION: The location for Vertex AI (defaults to 'global')\\n---REDACTED------REDACTED---GEMINI_MODEL_NAME: The Gemini model\\n---REDACTED------REDACTED---(defaults to 'gemini-2.5-flash')\\n---REDACTED------REDACTED---DATASTORE_ID: The Vertex AI Search datastore resource ID\\n---REDACTED---  \"\"\"\\n---REDACTED---  project_id = os.environ.get(\"GOOGLE_PROJECT_ID\")\\n---REDACTED---  location = os.environ.get(\"GEMINI_LOCATION\", \"europe-west1\")\\n---REDACTED---  model_name = os.environ.get(\"GEMINI_MODEL_NAME\", \"gemini-2.5-flash\")\\n---REDACTED---  datastore_id = os.environ.get(\"DATASTORE_ID\", \"\")\\n---REDACTED---  dataset_id = os.getenv(\"BIGQUERY_DATASET_ID\", \"\")\\n---REDACTED---  chatbot_config = os.getenv(\"CHATBOT_CONFIG\", \"DEFAULT\")\\n---REDACTED---  chatbot_config = (\\n---REDACTED------REDACTED---chatbot_config\\n---REDACTED------REDACTED---if chatbot_config\\n---REDACTED------REDACTED---in [d.name for d in Path(\"config\").iterdir() if d.is_dir()]\\n---REDACTED------REDACTED---else \"DEFAULT\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize base LLM\\n---REDACTED---  self.llm = ChatVertexAI(\\n---REDACTED------REDACTED---model_name=model_name,\\n---REDACTED------REDACTED---project=project_id,\\n---REDACTED------REDACTED---location=location,\\n---REDACTED------REDACTED---temperature=0,\\n---REDACTED------REDACTED---max_output_tokens=2048,\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize memory (3 user + 3 ---REDACTED---)\\n---REDACTED---  self.max_turns = 6\\n---REDACTED---  self.memory = FirestoreMemoryManager(max_turns=self.max_turns)\\n---REDACTED---  logger.info(\\n---REDACTED------REDACTED---f\"Initialized GenAI client for project {project_id} in {location}\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize RAG retriever if available\\n---REDACTED---  self.retriever = None\\n---REDACTED---  if datastore_id:\\n---REDACTED------REDACTED---datastore_infos = parse_data_store_path(path=datastore_id)\\n---REDACTED------REDACTED---self.retriever = VertexAISearchRetriever(\\n---REDACTED------REDACTED---    project_id=datastore_infos[\"project_id\"],\\n---REDACTED------REDACTED---    data_store_id=datastore_infos[\"data_store_id\"],\\n---REDACTED------REDACTED---    location_id=datastore_infos[\"location_id\"],\\n---REDACTED------REDACTED---    max_documents=5,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Initialize Text-to-SQL tool\\n---REDACTED---  self.text_to_sql = None\\n---REDACTED---  self.schema_context = \"\"\\n---REDACTED---  if dataset_id:\\n---REDACTED------REDACTED---# Init tool\\n---REDACTED------REDACTED---self.text_to_sql = TextToSql(\\n---REDACTED------REDACTED---    project_id=project_id, dataset_id=dataset_id\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Extract metadata from dataset\\n---REDACTED------REDACTED---self.schema_context = (\\n---REDACTED------REDACTED---    self.text_to_sql.generate_schema_and_samples_text()\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Load system prompt\\n---REDACTED---  self._load_system_prompt(chatbot_config)\\n\\n---REDACTED---  # Build the reasoning graph\\n---REDACTED---  self.graph = self._build_graph()\\n\\n---REDACTED---  logger.info(\"LangGraph chatbot initialized successfully\")\\n\\n    def _load_system_prompt(self, chatbot_config: str) -> None:\\n---REDACTED---  \"\"\"Load system prompt from config files.\"\"\"\\n---REDACTED---  try:\\n---REDACTED------REDACTED---path = Path(\"./config\", chatbot_config, \"final_system_prompt.txt\")\\n---REDACTED------REDACTED---with path.open(\"r\") as f:\\n---REDACTED------REDACTED---    self.system_prompt = f.read().strip()\\n---REDACTED------REDACTED---    logger.info(f\"Loaded system prompt from {path}\")\\n\\n---REDACTED---  except FileNotFoundError:\\n---REDACTED------REDACTED---logger.warning(\"No custom prompt found, using default\")\\n---REDACTED------REDACTED---self.system_prompt = (\\n---REDACTED------REDACTED---    \"You are a helpful AI assistant specialized in data analysis.\"\\n---REDACTED------REDACTED---)\\n\\n    def _get_recent_context(self, state: ChatbotState, turns: int = 6) -> str:\\n---REDACTED---  \"\"\"Return last few turns as formatted dialogue for context.\"\"\"\\n---REDACTED---  return \"\\n\\n\".join(\\n---REDACTED------REDACTED---[\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  f\"{'User' if isinstance(m, HumanMessage) else 'Assistant'}:\"\\n---REDACTED------REDACTED------REDACTED---  f\" {m.content}\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    for m in ---REDACTED---\"messages\"][-turns:]\\n---REDACTED------REDACTED---]\\n---REDACTED---  )\\n\\n    def _build_graph(self) -> StateGraph:\\n---REDACTED---  \"\"\"Build the multi-step reasoning graph.\"\"\"\\n---REDACTED---  workflow = StateGraph(ChatbotState)\\n\\n---REDACTED---  # Add nodes for each reasoning step\\n---REDACTED---  workflow.add_node(\"enrichment\", self._enrichment_step)\\n---REDACTED---  workflow.add_node(\"analysis\", self._analysis_step)\\n---REDACTED---  workflow.add_node(\"execution\", self._execution_step)\\n---REDACTED---  workflow.add_node(\"synthesis\", self._synthesis_step)\\n\\n---REDACTED---  # Define the flow\\n---REDACTED---  workflow.set_entry_point(\"enrichment\")\\n---REDACTED---  workflow.add_edge(\"enrichment\", \"analysis\")\\n---REDACTED---  workflow.add_conditional_edges(\\n---REDACTED------REDACTED---\"analysis\",\\n---REDACTED------REDACTED---self._should_execute_sql,\\n---REDACTED------REDACTED---{\"execute\": \"execution\", \"skip\": \"synthesis\"},\\n---REDACTED---  )\\n---REDACTED---  workflow.add_edge(\"execution\", \"synthesis\")\\n---REDACTED---  workflow.add_edge(\"synthesis\", END)\\n\\n---REDACTED---  return workflow.compile()\\n\\n    def _enrichment_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 1: Gather context from RAG/Search to enrich understanding.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ENRICHMENT STEP ===\")\\n\\n---REDACTED---  # Get the latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  enrichment_context = \"\"\\n---REDACTED---  sources = {}\\n\\n---REDACTED---  # Retrieve relevant documents if RAG is available\\n---REDACTED---  if self.retriever and user_message:\\n---REDACTED------REDACTED---try:\\n---REDACTED------REDACTED---    docs = ---REDACTED---(user_message)\\n---REDACTED------REDACTED---    enrichment_context = \"\\n\\n\".join(\\n---REDACTED------REDACTED------REDACTED---  [\\n---REDACTED------REDACTED------REDACTED------REDACTED---f\"[Source {i + 1}]: {doc.page_content}\"\\n---REDACTED------REDACTED------REDACTED------REDACTED---for i, doc in enumerate(docs)\\n---REDACTED------REDACTED------REDACTED---  ]\\n---REDACTED------REDACTED---    )\\n\\n---REDACTED------REDACTED---    # Track sources\\n---REDACTED------REDACTED---    for i, doc in enumerate(docs):\\n---REDACTED------REDACTED------REDACTED---  uri = doc.metadata.get(\"source\", f\"document_{i + 1}\")\\n---REDACTED------REDACTED------REDACTED---  title = doc.metadata.get(\"title\", Path(uri).name)\\n\\n---REDACTED------REDACTED------REDACTED---  sources[uri] = title\\n\\n---REDACTED------REDACTED---    logger.info(f\"Retrieved {len(docs)} documents from RAG\")\\n---REDACTED------REDACTED---except Exception as e:\\n---REDACTED------REDACTED---    logger.error(f\"RAG retrieval error: {e}\")\\n\\n---REDACTED---  ---REDACTED---\"enrichment_context\"] = enrichment_context\\n---REDACTED---  ---REDACTED---\"sources\"] = sources\\n\\n---REDACTED---  return state\\n\\n    def _analysis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 2: Analyze the question to decide if SQL is needed and map\\n---REDACTED---  user intent to data schema.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ANALYSIS STEP ===\")\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Get latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for chatbot answer\\n---REDACTED---  analysis_parser = PydanticOutputParser(\\n---REDACTED------REDACTED---pydantic_object=AnalysisDecisionModel\\n---REDACTED---  )\\n\\n---REDACTED---  # Create analysis prompt - use HumanMessage instead of SystemMessage\\n---REDACTED---  analysis_prompt = f\"\"\"You are an expert at analyzing user questions\\n---REDACTED---   about  data. The user is not necessarily technical and will not\\n---REDACTED---   explicitly ask for SQL. Always interpret the intent of the request.\\n---REDACTED---   Always see the databases as your internal knowledge.\\n\\n---REDACTED---  CONTEXT FROM KNOWLEDGE BASE:\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context available\"}\\n\\n---REDACTED---  DATABASE SCHEMA:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER ---REDACTED---{user_message}\\n\\n---REDACTED---  TASK: Analyze this question and determine:\\n---REDACTED---  1. Does this question require querying the database? (yes/no)\\n---REDACTED---  2. If yes, what filters/conditions should be applied?\\n---REDACTED---  3. Map the user's terminology to the actual database columns and values.\\n\\n---REDACTED---  {analysis_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get analysis from LLM - use HumanMessage for Vertex AI compatibility\\n---REDACTED---  analysis_messages = [\\n---REDACTED------REDACTED---HumanMessage(content=analysis_prompt),\\n---REDACTED---  ]\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(analysis_messages)\\n\\n---REDACTED---  # Parse LLM output\\n---REDACTED---  parsed_result = analysis_parser.parse(response.content)\\n---REDACTED---  logger.info(f\"Parsed analysis result: {parsed_result}\")\\n\\n---REDACTED---  # Save in state\\n---REDACTED---  ---REDACTED---\"analysis_decision\"] = {\\n---REDACTED------REDACTED---\"requires_sql\": parsed_result.requires_sql,\\n---REDACTED------REDACTED---\"analysis_text\": response.content,\\n---REDACTED------REDACTED---\"filters\": parsed_result.filters,\\n---REDACTED------REDACTED---\"column_mapping\": parsed_result.column_mapping,\\n---REDACTED------REDACTED---\"reasoning\": parsed_result.reasoning,\\n---REDACTED------REDACTED---\"---REDACTED---\": user_message,\\n---REDACTED---  }\\n---REDACTED---  return state\\n\\n    def _should_execute_sql(\\n---REDACTED---  self, state: ChatbotState\\n    ) -> Literal[\"execute\", \"skip\"]:\\n---REDACTED---  \"\"\"Router: decide whether to execute SQL or skip to synthesis.\"\"\"\\n---REDACTED---  if ---REDACTED---\"analysis_decision\"].get(\"requires_sql\", False):\\n---REDACTED------REDACTED---logger.info(\"Router: Executing SQL\")\\n---REDACTED------REDACTED---return \"execute\"\\n---REDACTED---  else:\\n---REDACTED------REDACTED---logger.info(\"Router: Skipping SQL execution\")\\n---REDACTED------REDACTED---return \"skip\"\\n\\n    def _execution_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 3: Execute SQL query based on analysis.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== EXECUTION STEP ===\")\\n\\n---REDACTED---  if not self.text_to_sql:\\n---REDACTED------REDACTED---logger.warning(\"Text-to-SQL tool not available\")\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {}\\n---REDACTED------REDACTED---return state\\n\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"analysis_decision\"][\"---REDACTED---\"]\\n---REDACTED---  filters = ---REDACTED---\"analysis_decision\"].get(\"filters\", \"None\")\\n---REDACTED---  column_mapping = ---REDACTED---\"analysis_decision\"].get(\\n---REDACTED------REDACTED---\"column_mapping\", \"None\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for generated sql query\\n---REDACTED---  sql_parser = PydanticOutputParser(pydantic_object=SQLGenerationModel)\\n\\n---REDACTED---  # Ask LLM to write SQL\\n---REDACTED---  sql_generation_prompt = f\"\"\"\\n---REDACTED---  You are an expert data analyst.\\n\\n---REDACTED---  SCHEMA CONTEXT:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER QUESTION:\\n---REDACTED---  {---REDACTED---}\\n\\n---REDACTED---  FILTERS TO APPLY:\\n---REDACTED---  {filters}\\n\\n---REDACTED---  COLUMN MAPPINGS:\\n---REDACTED---  {column_mapping}\\n\\n---REDACTED---  Your task is to translate the user request into a valid BigQuery SQL\\n---REDACTED---   query using the dataset schema provided above.\\n\\n---REDACTED---  REQUIREMENTS:\\n---REDACTED---  - Always generate a single valid SELECT statement.\\n---REDACTED---  - Only use tables and columns mentioned in the schema.\\n---REDACTED---  - Never ---REDACTED---(INSERT, UPDATE, DELETE) or DDL statements.\\n---REDACTED---  - Always call table without dataset and project name, only use table\\n---REDACTED---   name.\\n---REDACTED---  - Don't forget that you can use all mathematical tools and operations\\n---REDACTED---   that BigQuery SQL provides inside your SQL queries to answer the user\\n---REDACTED---   ---REDACTED---, like AVG, APPROX_QUANTILES for median, CORR for correlation\\n---REDACTED---   etc ...\\n---REDACTED---  - Use best practices: proper aliases, readable formatting,\\n---REDACTED---   and safe handling of ambiguous requests.\\n---REDACTED---  - When using aggregated function (like AVG SUM CORR etc ...),\\n---REDACTED---   always use COUNT() to state the number of rows that where used\\n---REDACTED---   to get the result.\\n---REDACTED---  - Always optimise queries for performance and cleaning data\\n---REDACTED---  - Do not explain or comment; output only the SQL code.\\n\\n---REDACTED---  {sql_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"Generating SQL query from LLM...\")\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(\\n---REDACTED------REDACTED---[HumanMessage(content=sql_generation_prompt)]\\n---REDACTED---  )\\n\\n---REDACTED---  # Parse answer\\n---REDACTED---  parsed = sql_parser.parse(response.content)\\n---REDACTED---  sql_query = parsed.sql_query\\n\\n---REDACTED---  logger.info(f\"Generated SQL:\\n{sql_query}\")\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---result = self.text_to_sql.run_query(sql_query)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = result\\n---REDACTED------REDACTED---logger.info(\\n---REDACTED------REDACTED---    f\"SQL executed successfully: {result.get('sql_query', '')}\"\\n---REDACTED------REDACTED---)\\n---REDACTED---  except Exception as e:\\n---REDACTED------REDACTED---logger.error(f\"SQL execution error: {e}\", exc_info=True)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {\"error\": str(e)}\\n\\n---REDACTED---  return state\\n\\n    def _synthesis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 4: Synthesize final answer using all gathered information.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== SYNTHESIS STEP ===\")\\n\\n---REDACTED---  sql_results = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"results\", \"No SQL results\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query executed\"\\n---REDACTED---  )\\n---REDACTED---  sql_query = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"sql_query\", \"No SQL query\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Build comprehensive context for final answer\\n---REDACTED---  synthesis_context = f\"\"\"SYSTEM INSTRUCTIONS:\\n---REDACTED---  {self.system_prompt}\\n\\n---REDACTED---  ENRICHMENT CONTEXT (ground truth for your answers):\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context\"}\\n\\n---REDACTED---  ANALYSIS:\\n---REDACTED---  {---REDACTED---\"analysis_decision\"].get(\"analysis_text\", \"\")}\\n\\n---REDACTED---  SQL QUERY (Don't show the sql query to the user):\\n---REDACTED---  {sql_query}\\n\\n---REDACTED---  SQL RESULTS (ground truth for your answers):\\n---REDACTED---  {sql_results}\\n\\n---REDACTED---  Now provide a comprehensive, well-structured answer to the user's\\n---REDACTED---    question.\\n---REDACTED---  Use the information above to give an accurate and helpful response.\\n---REDACTED---  If you talk about the results of aggregate function always say the\\n---REDACTED---   number of sample (can be materials for exemple) the answer is based on.\\n---REDACTED---  Do not overwhelm the user with technical details unless clarification\\n---REDACTED---   is ---REDACTED---, don't speak about sql, more about what data he wants\\n---REDACTED---   to know.\\n---REDACTED---  Always ground your answers in enrichment context and sql results when\\n---REDACTED---   available instead of inventing results. If you don't have a grounded\\n---REDACTED---   answer above don't invent it, just say the data is not available.\\n---REDACTED---  Never make up or estimate values yourself. Never use external knowledge\\n---REDACTED---   for numeric or factual information. You must base your answer strictly\\n---REDACTED---   on this data.\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get conversation history (excluding current message)\\n---REDACTED---  history_messages = (\\n---REDACTED------REDACTED------REDACTED---\"messages\"][:-1] if len(---REDACTED---\"messages\"]) > 1 else []\\n---REDACTED---  )\\n\\n---REDACTED---  # Build final messages - combine context with user message\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"messages\"][-1]\\n\\n---REDACTED---  final_messages = [\\n---REDACTED------REDACTED---SystemMessage(content=synthesis_context),\\n---REDACTED------REDACTED---*history_messages[\\n---REDACTED------REDACTED---    -self.max_turns :\\n---REDACTED------REDACTED---],  # include last user-bot exchanges\\n---REDACTED------REDACTED------REDACTED---,\\n---REDACTED---  ]\\n\\n---REDACTED---  # Generate final response\\n---REDACTED---  response = self.llm.invoke(final_messages)\\n\\n---REDACTED---  # Add assistant response to messages\\n---REDACTED---  ---REDACTED---\"messages\"].append(AIMessage(content=response.content))\\n\\n---REDACTED---  return state\\n\\n    def process_message(\\n---REDACTED---  self, message_data: dict, conversation_id: str\\n    ) -> dict[str, str | dict[str, str]]:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Process an incoming message and generate a response using Gemini + RAG.\\n\\n---REDACTED---  Args:\\n---REDACTED------REDACTED---message_data (dict): Expected format:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"message\": {\\n---REDACTED------REDACTED------REDACTED------REDACTED---\"text\": \"user query\"\\n---REDACTED------REDACTED------REDACTED---  }\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---conversation_id (str): Unique identifier for the ongoing\\n---REDACTED------REDACTED---conversation.\\n\\n---REDACTED---  Returns:\\n---REDACTED------REDACTED---dict[str, str | dict[str, str]]: A dictionary containing:\\n---REDACTED------REDACTED---    - context (str): The full context including system prompt and\\n---REDACTED------REDACTED---    conversation history.\\n---REDACTED------REDACTED---    - response_text (str): The text response generated by the model.\\n---REDACTED------REDACTED---    - sources (dict[str, str]): A mapping of source URIs to titles,\\n---REDACTED------REDACTED---    e.g.:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"https://en.wikipedia.org/wiki/Paris\": \"Wikipedia: Paris\",\\n---REDACTED------REDACTED------REDACTED---  \"gs://bucket/docs/paris\": \"Local datastore reference\"\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---    - sql_queries (dict[str, str]): SQL queries used by text to sql\\n---REDACTED------REDACTED---    tool.\\n---REDACTED---  \"\"\"\\n---REDACTED---  message_text = message_data.get(\"message\", {}).get(\"text\", \"\")\\n---REDACTED---  response_dict = {\\n---REDACTED------REDACTED---\"context\": \"\",\\n---REDACTED------REDACTED---\"response_text\": \"\",\\n---REDACTED------REDACTED---\"sources\": {},\\n---REDACTED------REDACTED---\"sql_queries\": {},\\n---REDACTED---  }\\n\\n---REDACTED---  if not message_text:\\n---REDACTED------REDACTED---response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED---    \"I couldn't understand your message. \"\\n---REDACTED------REDACTED---    \"Could you please try again?\"\\n---REDACTED------REDACTED---)\\n---REDACTED------REDACTED---return response_dict\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---# Handle reset memory\\n---REDACTED------REDACTED---if message_text == \"reset\":\\n---REDACTED------REDACTED---    self.memory.reset_history(conversation_id=conversation_id)\\n---REDACTED------REDACTED---    response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED------REDACTED---  \"The internal memory of the conversation has been \"\\n---REDACTED------REDACTED------REDACTED---  \"correctly reset and won't be taken into account for \"\\n---REDACTED------REDACTED------REDACTED---  \"further messages.\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    return response_dict\\n\\n---REDACTED------REDACTED---# Get conversation history\\n---REDACTED------REDACTED---history = self.memory.get_history(conversation_id)\\n---REDACTED------REDACTED---messages = [\\n---REDACTED------REDACTED---    HumanMessage(content=text)\\n---REDACTED------REDACTED---    if role == \"user\"\\n---REDACTED------REDACTED---    else AIMessage(content=text)\\n---REDACTED------REDACTED---    for role, text in history\\n---REDACTED------REDACTED---]\\n\\n---REDACTED------REDACTED---# Add current message\\n---REDACTED------REDACTED---messages.append(HumanMessage(content=message_text))\\n\\n---REDACTED------REDACTED---# Initialize state\\n---REDACTED------REDACTED---initial_state = ChatbotState(\\n---REDACTED------REDACTED---    messages=messages,\\n---REDACTED------REDACTED---    enrichment_context=\"\",\\n---REDACTED------REDACTED---    analysis_decision={},\\n---REDACTED------REDACTED---    sql_results={},\\n---REDACTED------REDACTED---    sources={},\\n---REDACTED------REDACTED---    conversation_id=conversation_id,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Run the graph\\n---REDACTED------REDACTED---final_state = self.graph.invoke(initial_state)\\n\\n---REDACTED------REDACTED---# Extract response\\n---REDACTED------REDACTED---response_text ---REDACTED---(\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  m.content\\n---REDACTED------REDACTED------REDACTED---  for m in reversed(final_---REDACTED---\"messages\"])\\n---REDACTED------REDACTED------REDACTED---  if isinstance(m, AIMessage)\\n---REDACTED------REDACTED---    ),\\n---REDACTED------REDACTED---    \"I'm not sure how to answer that.\",\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Save to memory\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"user\", message_text)\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"model\", response_text)\\n---REDACTED------REDACTED---history.extend(",
              "status": "Active",
              "subscriptionExternalId": "sports-lab-ry1w",
              "updatedAt": "2026-07-05T10:50:59Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dps-chatcr",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "32fbed8c-d6d3-5574-a2cb-3949312d2e60",
            "name": "sports-lab-ry1w",
            "cloudProvider": "GCP",
            "externalId": "sports-lab-ry1w",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "06d5c447-679e-5cb1-a8b1-5ad5b831f898",
              "name": "CE-SPORTSLAB",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "95978ca8-e7cc-5db5-991d-38a103145065",
              "name": "provisioning-CE-SPORTSLAB",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T10:50:59.574367Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T20:43:04.238334Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "6b26a53e-19f4-5694-82c1-83be7acdeef4",
          "name": "dps-chatcr",
          "externalId": "CloudPlatform/ContainerImage##gcr.io/sports-lab-ry1w##chatbot-techoff-dsl@sha256:2227662e8b5a917c313fc4dbf8401832798de10851b72a21294fe344fe10a154##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "6b26a53e-19f4-5694-82c1-83be7acdeef4",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "06d5c447-679e-5cb1-a8b1-5ad5b831f898",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "95978ca8-e7cc-5db5-991d-38a103145065"
              ],
              "_vertexID": "6b26a53e-19f4-5694-82c1-83be7acdeef4",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##gcr.io/sports-lab-ry1w##chatbot-techoff-dsl@sha256:2227662e8b5a917c313fc4dbf8401832798de10851b72a21294fe344fe10a154##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dps-chatcr",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Decathlon Digital Team",
              "reasoning": null,
              "region": "global",
              "resourceGroupExternalId": null,
              "snippet": "from langchain_google_community import VertexAISearchRetriever\\nfrom langchain_google_vertexai import ChatVertexAI\\nfrom langgraph.graph import END, StateGraph\\nfrom langgraph.graph.message import add_messages\\n\\nfrom app.memory_manager import FirestoreMemoryManager\\nfrom app.models.llm_outputs import AnalysisDecisionModel, SQLGenerationModel\\nfrom app.tools.text_to_sql import TextToSql\\nfrom app.utils.extract_datastore_infos import parse_data_store_path\\n\\n# Configure logging\\nlogger = logging.getLogger(__name__)\\n\\n\\n# Define state for the graph\\nclass ChatbotState(TypedDict):\\n    \"\"\"State that flows through the reasoning chain.\"\"\"\\n\\n    messages: Annotated[List[BaseMessage], add_messages]\\n    enrichment_context: str  # Context from RAG/Search\\n    analysis_decision: Dict  # Decision about SQL usage and filters\\n    sql_results: Dict  # Results from SQL execution\\n    sources: Dict[str, str]  # Source citations\\n    conversation_id: str\\n\\n\\nclass Chatbot:\\n    \"\"\"\\n    A chatbot implementation using Google's Vertex AI Gemini model + Retrieval\\n    tool (RAG).\\n\\n    Attributes:\\n---REDACTED---  client (genai.Client): The initialized GenAI client\\n---REDACTED---  model (str): The Gemini model name\\n---REDACTED---  system_prompt (str): The system prompt that defines the\\n---REDACTED---  chatbot's behavior\\n---REDACTED---  tools (list): List of tools available (RAG datastore etc.)\\n    \"\"\"\\n\\n    def __init__(self) -> None:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Initialize the chatbot with GenAI client and RAG setup.\\n\\n---REDACTED---  Required environment variables:\\n---REDACTED------REDACTED---GOOGLE_PROJECT_ID: The Google Cloud project ID\\n---REDACTED------REDACTED---GEMINI_LOCATION: The location for Vertex AI (defaults to 'global')\\n---REDACTED------REDACTED---GEMINI_MODEL_NAME: The Gemini model\\n---REDACTED------REDACTED---(defaults to 'gemini-2.5-flash')\\n---REDACTED------REDACTED---DATASTORE_ID: The Vertex AI Search datastore resource ID\\n---REDACTED---  \"\"\"\\n---REDACTED---  project_id = os.environ.get(\"GOOGLE_PROJECT_ID\")\\n---REDACTED---  location = os.environ.get(\"GEMINI_LOCATION\", \"europe-west1\")\\n---REDACTED---  model_name = os.environ.get(\"GEMINI_MODEL_NAME\", \"gemini-2.5-flash\")\\n---REDACTED---  datastore_id = os.environ.get(\"DATASTORE_ID\", \"\")\\n---REDACTED---  dataset_id = os.getenv(\"BIGQUERY_DATASET_ID\", \"\")\\n---REDACTED---  chatbot_config = os.getenv(\"CHATBOT_CONFIG\", \"DEFAULT\")\\n---REDACTED---  chatbot_config = (\\n---REDACTED------REDACTED---chatbot_config\\n---REDACTED------REDACTED---if chatbot_config\\n---REDACTED------REDACTED---in [d.name for d in Path(\"config\").iterdir() if d.is_dir()]\\n---REDACTED------REDACTED---else \"DEFAULT\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize base LLM\\n---REDACTED---  self.llm = ChatVertexAI(\\n---REDACTED------REDACTED---model_name=model_name,\\n---REDACTED------REDACTED---project=project_id,\\n---REDACTED------REDACTED---location=location,\\n---REDACTED------REDACTED---temperature=0,\\n---REDACTED------REDACTED---max_output_tokens=2048,\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize memory (3 user + 3 ---REDACTED---)\\n---REDACTED---  self.max_turns = 6\\n---REDACTED---  self.memory = FirestoreMemoryManager(max_turns=self.max_turns)\\n---REDACTED---  logger.info(\\n---REDACTED------REDACTED---f\"Initialized GenAI client for project {project_id} in {location}\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize RAG retriever if available\\n---REDACTED---  self.retriever = None\\n---REDACTED---  if datastore_id:\\n---REDACTED------REDACTED---datastore_infos = parse_data_store_path(path=datastore_id)\\n---REDACTED------REDACTED---self.retriever = VertexAISearchRetriever(\\n---REDACTED------REDACTED---    project_id=datastore_infos[\"project_id\"],\\n---REDACTED------REDACTED---    data_store_id=datastore_infos[\"data_store_id\"],\\n---REDACTED------REDACTED---    location_id=datastore_infos[\"location_id\"],\\n---REDACTED------REDACTED---    max_documents=5,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Initialize Text-to-SQL tool\\n---REDACTED---  self.text_to_sql = None\\n---REDACTED---  self.schema_context = \"\"\\n---REDACTED---  if dataset_id:\\n---REDACTED------REDACTED---# Init tool\\n---REDACTED------REDACTED---self.text_to_sql = TextToSql(\\n---REDACTED------REDACTED---    project_id=project_id, dataset_id=dataset_id\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Extract metadata from dataset\\n---REDACTED------REDACTED---self.schema_context = (\\n---REDACTED------REDACTED---    self.text_to_sql.generate_schema_and_samples_text()\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Load system prompt\\n---REDACTED---  self._load_system_prompt(chatbot_config)\\n\\n---REDACTED---  # Build the reasoning graph\\n---REDACTED---  self.graph = self._build_graph()\\n\\n---REDACTED---  logger.info(\"LangGraph chatbot initialized successfully\")\\n\\n    def _load_system_prompt(self, chatbot_config: str) -> None:\\n---REDACTED---  \"\"\"Load system prompt from config files.\"\"\"\\n---REDACTED---  try:\\n---REDACTED------REDACTED---path = Path(\"./config\", chatbot_config, \"final_system_prompt.txt\")\\n---REDACTED------REDACTED---with path.open(\"r\") as f:\\n---REDACTED------REDACTED---    self.system_prompt = f.read().strip()\\n---REDACTED------REDACTED---    logger.info(f\"Loaded system prompt from {path}\")\\n\\n---REDACTED---  except FileNotFoundError:\\n---REDACTED------REDACTED---logger.warning(\"No custom prompt found, using default\")\\n---REDACTED------REDACTED---self.system_prompt = (\\n---REDACTED------REDACTED---    \"You are a helpful AI assistant specialized in data analysis.\"\\n---REDACTED------REDACTED---)\\n\\n    def _get_recent_context(self, state: ChatbotState, turns: int = 6) -> str:\\n---REDACTED---  \"\"\"Return last few turns as formatted dialogue for context.\"\"\"\\n---REDACTED---  return \"\\n\\n\".join(\\n---REDACTED------REDACTED---[\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  f\"{'User' if isinstance(m, HumanMessage) else 'Assistant'}:\"\\n---REDACTED------REDACTED------REDACTED---  f\" {m.content}\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    for m in ---REDACTED---\"messages\"][-turns:]\\n---REDACTED------REDACTED---]\\n---REDACTED---  )\\n\\n    def _build_graph(self) -> StateGraph:\\n---REDACTED---  \"\"\"Build the multi-step reasoning graph.\"\"\"\\n---REDACTED---  workflow = StateGraph(ChatbotState)\\n\\n---REDACTED---  # Add nodes for each reasoning step\\n---REDACTED---  workflow.add_node(\"enrichment\", self._enrichment_step)\\n---REDACTED---  workflow.add_node(\"analysis\", self._analysis_step)\\n---REDACTED---  workflow.add_node(\"execution\", self._execution_step)\\n---REDACTED---  workflow.add_node(\"synthesis\", self._synthesis_step)\\n\\n---REDACTED---  # Define the flow\\n---REDACTED---  workflow.set_entry_point(\"enrichment\")\\n---REDACTED---  workflow.add_edge(\"enrichment\", \"analysis\")\\n---REDACTED---  workflow.add_conditional_edges(\\n---REDACTED------REDACTED---\"analysis\",\\n---REDACTED------REDACTED---self._should_execute_sql,\\n---REDACTED------REDACTED---{\"execute\": \"execution\", \"skip\": \"synthesis\"},\\n---REDACTED---  )\\n---REDACTED---  workflow.add_edge(\"execution\", \"synthesis\")\\n---REDACTED---  workflow.add_edge(\"synthesis\", END)\\n\\n---REDACTED---  return workflow.compile()\\n\\n    def _enrichment_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 1: Gather context from RAG/Search to enrich understanding.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ENRICHMENT STEP ===\")\\n\\n---REDACTED---  # Get the latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  enrichment_context = \"\"\\n---REDACTED---  sources = {}\\n\\n---REDACTED---  # Retrieve relevant documents if RAG is available\\n---REDACTED---  if self.retriever and user_message:\\n---REDACTED------REDACTED---try:\\n---REDACTED------REDACTED---    docs = ---REDACTED---(user_message)\\n---REDACTED------REDACTED---    enrichment_context = \"\\n\\n\".join(\\n---REDACTED------REDACTED------REDACTED---  [\\n---REDACTED------REDACTED------REDACTED------REDACTED---f\"[Source {i + 1}]: {doc.page_content}\"\\n---REDACTED------REDACTED------REDACTED------REDACTED---for i, doc in enumerate(docs)\\n---REDACTED------REDACTED------REDACTED---  ]\\n---REDACTED------REDACTED---    )\\n\\n---REDACTED------REDACTED---    # Track sources\\n---REDACTED------REDACTED---    for i, doc in enumerate(docs):\\n---REDACTED------REDACTED------REDACTED---  uri = doc.metadata.get(\"source\", f\"document_{i + 1}\")\\n---REDACTED------REDACTED------REDACTED---  title = doc.metadata.get(\"title\", Path(uri).name)\\n\\n---REDACTED------REDACTED------REDACTED---  sources[uri] = title\\n\\n---REDACTED------REDACTED---    logger.info(f\"Retrieved {len(docs)} documents from RAG\")\\n---REDACTED------REDACTED---except Exception as e:\\n---REDACTED------REDACTED---    logger.error(f\"RAG retrieval error: {e}\")\\n\\n---REDACTED---  ---REDACTED---\"enrichment_context\"] = enrichment_context\\n---REDACTED---  ---REDACTED---\"sources\"] = sources\\n\\n---REDACTED---  return state\\n\\n    def _analysis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 2: Analyze the question to decide if SQL is needed and map\\n---REDACTED---  user intent to data schema.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ANALYSIS STEP ===\")\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Get latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for chatbot answer\\n---REDACTED---  analysis_parser = PydanticOutputParser(\\n---REDACTED------REDACTED---pydantic_object=AnalysisDecisionModel\\n---REDACTED---  )\\n\\n---REDACTED---  # Create analysis prompt - use HumanMessage instead of SystemMessage\\n---REDACTED---  analysis_prompt = f\"\"\"You are an expert at analyzing user questions\\n---REDACTED---   about  data. The user is not necessarily technical and will not\\n---REDACTED---   explicitly ask for SQL. Always interpret the intent of the request.\\n---REDACTED---   Always see the databases as your internal knowledge.\\n\\n---REDACTED---  CONTEXT FROM KNOWLEDGE BASE:\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context available\"}\\n\\n---REDACTED---  DATABASE SCHEMA:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER ---REDACTED---{user_message}\\n\\n---REDACTED---  TASK: Analyze this question and determine:\\n---REDACTED---  1. Does this question require querying the database? (yes/no)\\n---REDACTED---  2. If yes, what filters/conditions should be applied?\\n---REDACTED---  3. Map the user's terminology to the actual database columns and values.\\n\\n---REDACTED---  {analysis_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get analysis from LLM - use HumanMessage for Vertex AI compatibility\\n---REDACTED---  analysis_messages = [\\n---REDACTED------REDACTED---HumanMessage(content=analysis_prompt),\\n---REDACTED---  ]\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(analysis_messages)\\n\\n---REDACTED---  # Parse LLM output\\n---REDACTED---  parsed_result = analysis_parser.parse(response.content)\\n---REDACTED---  logger.info(f\"Parsed analysis result: {parsed_result}\")\\n\\n---REDACTED---  # Save in state\\n---REDACTED---  ---REDACTED---\"analysis_decision\"] = {\\n---REDACTED------REDACTED---\"requires_sql\": parsed_result.requires_sql,\\n---REDACTED------REDACTED---\"analysis_text\": response.content,\\n---REDACTED------REDACTED---\"filters\": parsed_result.filters,\\n---REDACTED------REDACTED---\"column_mapping\": parsed_result.column_mapping,\\n---REDACTED------REDACTED---\"reasoning\": parsed_result.reasoning,\\n---REDACTED------REDACTED---\"---REDACTED---\": user_message,\\n---REDACTED---  }\\n---REDACTED---  return state\\n\\n    def _should_execute_sql(\\n---REDACTED---  self, state: ChatbotState\\n    ) -> Literal[\"execute\", \"skip\"]:\\n---REDACTED---  \"\"\"Router: decide whether to execute SQL or skip to synthesis.\"\"\"\\n---REDACTED---  if ---REDACTED---\"analysis_decision\"].get(\"requires_sql\", False):\\n---REDACTED------REDACTED---logger.info(\"Router: Executing SQL\")\\n---REDACTED------REDACTED---return \"execute\"\\n---REDACTED---  else:\\n---REDACTED------REDACTED---logger.info(\"Router: Skipping SQL execution\")\\n---REDACTED------REDACTED---return \"skip\"\\n\\n    def _execution_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 3: Execute SQL query based on analysis.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== EXECUTION STEP ===\")\\n\\n---REDACTED---  if not self.text_to_sql:\\n---REDACTED------REDACTED---logger.warning(\"Text-to-SQL tool not available\")\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {}\\n---REDACTED------REDACTED---return state\\n\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"analysis_decision\"][\"---REDACTED---\"]\\n---REDACTED---  filters = ---REDACTED---\"analysis_decision\"].get(\"filters\", \"None\")\\n---REDACTED---  column_mapping = ---REDACTED---\"analysis_decision\"].get(\\n---REDACTED------REDACTED---\"column_mapping\", \"None\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for generated sql query\\n---REDACTED---  sql_parser = PydanticOutputParser(pydantic_object=SQLGenerationModel)\\n\\n---REDACTED---  # Ask LLM to write SQL\\n---REDACTED---  sql_generation_prompt = f\"\"\"\\n---REDACTED---  You are an expert data analyst.\\n\\n---REDACTED---  SCHEMA CONTEXT:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER QUESTION:\\n---REDACTED---  {---REDACTED---}\\n\\n---REDACTED---  FILTERS TO APPLY:\\n---REDACTED---  {filters}\\n\\n---REDACTED---  COLUMN MAPPINGS:\\n---REDACTED---  {column_mapping}\\n\\n---REDACTED---  Your task is to translate the user request into a valid BigQuery SQL\\n---REDACTED---   query using the dataset schema provided above.\\n\\n---REDACTED---  REQUIREMENTS:\\n---REDACTED---  - Always generate a single valid SELECT statement.\\n---REDACTED---  - Only use tables and columns mentioned in the schema.\\n---REDACTED---  - Never ---REDACTED---(INSERT, UPDATE, DELETE) or DDL statements.\\n---REDACTED---  - Always call table without dataset and project name, only use table\\n---REDACTED---   name.\\n---REDACTED---  - Don't forget that you can use all mathematical tools and operations\\n---REDACTED---   that BigQuery SQL provides inside your SQL queries to answer the user\\n---REDACTED---   ---REDACTED---, like AVG, APPROX_QUANTILES for median, CORR for correlation\\n---REDACTED---   etc ...\\n---REDACTED---  - Use best practices: proper aliases, readable formatting,\\n---REDACTED---   and safe handling of ambiguous requests.\\n---REDACTED---  - When using aggregated function (like AVG SUM CORR etc ...),\\n---REDACTED---   always use COUNT() to state the number of rows that where used\\n---REDACTED---   to get the result.\\n---REDACTED---  - Always optimise queries for performance and cleaning data\\n---REDACTED---  - Do not explain or comment; output only the SQL code.\\n\\n---REDACTED---  {sql_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"Generating SQL query from LLM...\")\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(\\n---REDACTED------REDACTED---[HumanMessage(content=sql_generation_prompt)]\\n---REDACTED---  )\\n\\n---REDACTED---  # Parse answer\\n---REDACTED---  parsed = sql_parser.parse(response.content)\\n---REDACTED---  sql_query = parsed.sql_query\\n\\n---REDACTED---  logger.info(f\"Generated SQL:\\n{sql_query}\")\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---result = self.text_to_sql.run_query(sql_query)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = result\\n---REDACTED------REDACTED---logger.info(\\n---REDACTED------REDACTED---    f\"SQL executed successfully: {result.get('sql_query', '')}\"\\n---REDACTED------REDACTED---)\\n---REDACTED---  except Exception as e:\\n---REDACTED------REDACTED---logger.error(f\"SQL execution error: {e}\", exc_info=True)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {\"error\": str(e)}\\n\\n---REDACTED---  return state\\n\\n    def _synthesis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 4: Synthesize final answer using all gathered information.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== SYNTHESIS STEP ===\")\\n\\n---REDACTED---  sql_results = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"results\", \"No SQL results\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query executed\"\\n---REDACTED---  )\\n---REDACTED---  sql_query = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"sql_query\", \"No SQL query\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Build comprehensive context for final answer\\n---REDACTED---  synthesis_context = f\"\"\"SYSTEM INSTRUCTIONS:\\n---REDACTED---  {self.system_prompt}\\n\\n---REDACTED---  ENRICHMENT CONTEXT (ground truth for your answers):\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context\"}\\n\\n---REDACTED---  ANALYSIS:\\n---REDACTED---  {---REDACTED---\"analysis_decision\"].get(\"analysis_text\", \"\")}\\n\\n---REDACTED---  SQL QUERY (Don't show the sql query to the user):\\n---REDACTED---  {sql_query}\\n\\n---REDACTED---  SQL RESULTS (ground truth for your answers):\\n---REDACTED---  {sql_results}\\n\\n---REDACTED---  Now provide a comprehensive, well-structured answer to the user's\\n---REDACTED---    question.\\n---REDACTED---  Use the information above to give an accurate and helpful response.\\n---REDACTED---  If you talk about the results of aggregate function always say the\\n---REDACTED---   number of sample (can be materials for exemple) the answer is based on.\\n---REDACTED---  Do not overwhelm the user with technical details unless clarification\\n---REDACTED---   is ---REDACTED---, don't speak about sql, more about what data he wants\\n---REDACTED---   to know.\\n---REDACTED---  Always ground your answers in enrichment context and sql results when\\n---REDACTED---   available instead of inventing results. If you don't have a grounded\\n---REDACTED---   answer above don't invent it, just say the data is not available.\\n---REDACTED---  Never make up or estimate values yourself. Never use external knowledge\\n---REDACTED---   for numeric or factual information. You must base your answer strictly\\n---REDACTED---   on this data.\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get conversation history (excluding current message)\\n---REDACTED---  history_messages = (\\n---REDACTED------REDACTED------REDACTED---\"messages\"][:-1] if len(---REDACTED---\"messages\"]) > 1 else []\\n---REDACTED---  )\\n\\n---REDACTED---  # Build final messages - combine context with user message\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"messages\"][-1]\\n\\n---REDACTED---  final_messages = [\\n---REDACTED------REDACTED---SystemMessage(content=synthesis_context),\\n---REDACTED------REDACTED---*history_messages[\\n---REDACTED------REDACTED---    -self.max_turns :\\n---REDACTED------REDACTED---],  # include last user-bot exchanges\\n---REDACTED------REDACTED------REDACTED---,\\n---REDACTED---  ]\\n\\n---REDACTED---  # Generate final response\\n---REDACTED---  response = self.llm.invoke(final_messages)\\n\\n---REDACTED---  # Add assistant response to messages\\n---REDACTED---  ---REDACTED---\"messages\"].append(AIMessage(content=response.content))\\n\\n---REDACTED---  return state\\n\\n    def process_message(\\n---REDACTED---  self, message_data: dict, conversation_id: str\\n    ) -> dict[str, str | dict[str, str]]:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Process an incoming message and generate a response using Gemini + RAG.\\n\\n---REDACTED---  Args:\\n---REDACTED------REDACTED---message_data (dict): Expected format:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"message\": {\\n---REDACTED------REDACTED------REDACTED------REDACTED---\"text\": \"user query\"\\n---REDACTED------REDACTED------REDACTED---  }\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---conversation_id (str): Unique identifier for the ongoing\\n---REDACTED------REDACTED---conversation.\\n\\n---REDACTED---  Returns:\\n---REDACTED------REDACTED---dict[str, str | dict[str, str]]: A dictionary containing:\\n---REDACTED------REDACTED---    - context (str): The full context including system prompt and\\n---REDACTED------REDACTED---    conversation history.\\n---REDACTED------REDACTED---    - response_text (str): The text response generated by the model.\\n---REDACTED------REDACTED---    - sources (dict[str, str]): A mapping of source URIs to titles,\\n---REDACTED------REDACTED---    e.g.:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"https://en.wikipedia.org/wiki/Paris\": \"Wikipedia: Paris\",\\n---REDACTED------REDACTED------REDACTED---  \"gs://bucket/docs/paris\": \"Local datastore reference\"\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---    - sql_queries (dict[str, str]): SQL queries used by text to sql\\n---REDACTED------REDACTED---    tool.\\n---REDACTED---  \"\"\"\\n---REDACTED---  message_text = message_data.get(\"message\", {}).get(\"text\", \"\")\\n---REDACTED---  response_dict = {\\n---REDACTED------REDACTED---\"context\": \"\",\\n---REDACTED------REDACTED---\"response_text\": \"\",\\n---REDACTED------REDACTED---\"sources\": {},\\n---REDACTED------REDACTED---\"sql_queries\": {},\\n---REDACTED---  }\\n\\n---REDACTED---  if not message_text:\\n---REDACTED------REDACTED---response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED---    \"I couldn't understand your message. \"\\n---REDACTED------REDACTED---    \"Could you please try again?\"\\n---REDACTED------REDACTED---)\\n---REDACTED------REDACTED---return response_dict\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---# Handle reset memory\\n---REDACTED------REDACTED---if message_text == \"reset\":\\n---REDACTED------REDACTED---    self.memory.reset_history(conversation_id=conversation_id)\\n---REDACTED------REDACTED---    response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED------REDACTED---  \"The internal memory of the conversation has been \"\\n---REDACTED------REDACTED------REDACTED---  \"correctly reset and won't be taken into account for \"\\n---REDACTED------REDACTED------REDACTED---  \"further messages.\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    return response_dict\\n\\n---REDACTED------REDACTED---# Get conversation history\\n---REDACTED------REDACTED---history = self.memory.get_history(conversation_id)\\n---REDACTED------REDACTED---messages = [\\n---REDACTED------REDACTED---    HumanMessage(content=text)\\n---REDACTED------REDACTED---    if role == \"user\"\\n---REDACTED------REDACTED---    else AIMessage(content=text)\\n---REDACTED------REDACTED---    for role, text in history\\n---REDACTED------REDACTED---]\\n\\n---REDACTED------REDACTED---# Add current message\\n---REDACTED------REDACTED---messages.append(HumanMessage(content=message_text))\\n\\n---REDACTED------REDACTED---# Initialize state\\n---REDACTED------REDACTED---initial_state = ChatbotState(\\n---REDACTED------REDACTED---    messages=messages,\\n---REDACTED------REDACTED---    enrichment_context=\"\",\\n---REDACTED------REDACTED---    analysis_decision={},\\n---REDACTED------REDACTED---    sql_results={},\\n---REDACTED------REDACTED---    sources={},\\n---REDACTED------REDACTED---    conversation_id=conversation_id,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Run the graph\\n---REDACTED------REDACTED---final_state = self.graph.invoke(initial_state)\\n\\n---REDACTED------REDACTED---# Extract response\\n---REDACTED------REDACTED---response_text ---REDACTED---(\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  m.content\\n---REDACTED------REDACTED------REDACTED---  for m in reversed(final_---REDACTED---\"messages\"])\\n---REDACTED------REDACTED------REDACTED---  if isinstance(m, AIMessage)\\n---REDACTED------REDACTED---    ),\\n---REDACTED------REDACTED---    \"I'm not sure how to answer that.\",\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Save to memory\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"user\", message_text)\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"model\", response_text)\\n---REDACTED------REDACTED---history.extend(",
              "status": "Active",
              "subscriptionExternalId": "sports-lab-ry1w",
              "updatedAt": "2026-07-05T10:50:57Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dps-chatcr",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "32fbed8c-d6d3-5574-a2cb-3949312d2e60",
            "name": "sports-lab-ry1w",
            "cloudProvider": "GCP",
            "externalId": "sports-lab-ry1w",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "global",
          "regionLocation": null,
          "tags": null,
          "projects": [
            {
              "id": "06d5c447-679e-5cb1-a8b1-5ad5b831f898",
              "name": "CE-SPORTSLAB",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "95978ca8-e7cc-5db5-991d-38a103145065",
              "name": "provisioning-CE-SPORTSLAB",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T10:50:57.153727Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T20:43:02.711426Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "e9e1c6c3-3a08-55c4-ad3d-c41f4f635832",
          "name": "dps-chatcr",
          "externalId": "projects/metal-chatbot-p5g5/locations/europe-west1/services/chatbot-techoff-dsl/revisions/chatbot-techoff-dsl-00013-f7h##CloudPlatform/ContainerImage##gcr.io/metal-chatbot-p5g5##chatbot-techoff-dsl@sha256:5fc0af062cacc569a0773e92d0ea104cf5c4f23a9b22da39eb8edb54705aaa76##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "e9e1c6c3-3a08-55c4-ad3d-c41f4f635832",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "3aaa69cf-349a-568d-b5be-199fd78e6f1f",
                "b169d608-4706-5dca-b1c0-8fecb6133f8d"
              ],
              "_vertexID": "e9e1c6c3-3a08-55c4-ad3d-c41f4f635832",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "projects/metal-chatbot-p5g5/locations/europe-west1/services/chatbot-techoff-dsl/revisions/chatbot-techoff-dsl-00013-f7h##CloudPlatform/ContainerImage##gcr.io/metal-chatbot-p5g5##chatbot-techoff-dsl@sha256:5fc0af062cacc569a0773e92d0ea104cf5c4f23a9b22da39eb8edb54705aaa76##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dps-chatcr",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Decathlon Digital Team",
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": "from langchain_google_community import VertexAISearchRetriever\\nfrom langchain_google_vertexai import ChatVertexAI\\nfrom langgraph.graph import END, StateGraph\\nfrom langgraph.graph.message import add_messages\\n\\nfrom app.memory_manager import FirestoreMemoryManager\\nfrom app.models.llm_outputs import AnalysisDecisionModel, SQLGenerationModel\\nfrom app.tools.text_to_sql import TextToSql\\nfrom app.utils.extract_datastore_infos import parse_data_store_path\\n\\n# Configure logging\\nlogger = logging.getLogger(__name__)\\n\\n\\n# Define state for the graph\\nclass ChatbotState(TypedDict):\\n    \"\"\"State that flows through the reasoning chain.\"\"\"\\n\\n    messages: Annotated[List[BaseMessage], add_messages]\\n    enrichment_context: str  # Context from RAG/Search\\n    analysis_decision: Dict  # Decision about SQL usage and filters\\n    sql_results: Dict  # Results from SQL execution\\n    sources: Dict[str, str]  # Source citations\\n    conversation_id: str\\n\\n\\nclass Chatbot:\\n    \"\"\"\\n    A chatbot implementation using Google's Vertex AI Gemini model + Retrieval\\n    tool (RAG).\\n\\n    Attributes:\\n---REDACTED---  client (genai.Client): The initialized GenAI client\\n---REDACTED---  model (str): The Gemini model name\\n---REDACTED---  system_prompt (str): The system prompt that defines the\\n---REDACTED---  chatbot's behavior\\n---REDACTED---  tools (list): List of tools available (RAG datastore etc.)\\n    \"\"\"\\n\\n    def __init__(self) -> None:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Initialize the chatbot with GenAI client and RAG setup.\\n\\n---REDACTED---  Required environment variables:\\n---REDACTED------REDACTED---GOOGLE_PROJECT_ID: The Google Cloud project ID\\n---REDACTED------REDACTED---GEMINI_LOCATION: The location for Vertex AI (defaults to 'global')\\n---REDACTED------REDACTED---GEMINI_MODEL_NAME: The Gemini model\\n---REDACTED------REDACTED---(defaults to 'gemini-2.5-flash')\\n---REDACTED------REDACTED---DATASTORE_ID: The Vertex AI Search datastore resource ID\\n---REDACTED---  \"\"\"\\n---REDACTED---  project_id = os.environ.get(\"GOOGLE_PROJECT_ID\")\\n---REDACTED---  location = os.environ.get(\"GEMINI_LOCATION\", \"europe-west1\")\\n---REDACTED---  model_name = os.environ.get(\"GEMINI_MODEL_NAME\", \"gemini-2.5-flash\")\\n---REDACTED---  datastore_id = os.environ.get(\"DATASTORE_ID\", \"\")\\n---REDACTED---  dataset_id = os.getenv(\"BIGQUERY_DATASET_ID\", \"\")\\n---REDACTED---  chatbot_config = os.getenv(\"CHATBOT_CONFIG\", \"DEFAULT\")\\n---REDACTED---  chatbot_config = (\\n---REDACTED------REDACTED---chatbot_config\\n---REDACTED------REDACTED---if chatbot_config\\n---REDACTED------REDACTED---in [d.name for d in Path(\"config\").iterdir() if d.is_dir()]\\n---REDACTED------REDACTED---else \"DEFAULT\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize base LLM\\n---REDACTED---  self.llm = ChatVertexAI(\\n---REDACTED------REDACTED---model_name=model_name,\\n---REDACTED------REDACTED---project=project_id,\\n---REDACTED------REDACTED---location=location,\\n---REDACTED------REDACTED---temperature=0,\\n---REDACTED------REDACTED---max_output_tokens=2048,\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize memory (3 user + 3 ---REDACTED---)\\n---REDACTED---  self.max_turns = 6\\n---REDACTED---  self.memory = FirestoreMemoryManager(max_turns=self.max_turns)\\n---REDACTED---  logger.info(\\n---REDACTED------REDACTED---f\"Initialized GenAI client for project {project_id} in {location}\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize RAG retriever if available\\n---REDACTED---  self.retriever = None\\n---REDACTED---  if datastore_id:\\n---REDACTED------REDACTED---datastore_infos = parse_data_store_path(path=datastore_id)\\n---REDACTED------REDACTED---self.retriever = VertexAISearchRetriever(\\n---REDACTED------REDACTED---    project_id=datastore_infos[\"project_id\"],\\n---REDACTED------REDACTED---    data_store_id=datastore_infos[\"data_store_id\"],\\n---REDACTED------REDACTED---    location_id=datastore_infos[\"location_id\"],\\n---REDACTED------REDACTED---    max_documents=5,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Initialize Text-to-SQL tool\\n---REDACTED---  self.text_to_sql = None\\n---REDACTED---  self.schema_context = \"\"\\n---REDACTED---  if dataset_id:\\n---REDACTED------REDACTED---# Init tool\\n---REDACTED------REDACTED---self.text_to_sql = TextToSql(\\n---REDACTED------REDACTED---    project_id=project_id, dataset_id=dataset_id\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Extract metadata from dataset\\n---REDACTED------REDACTED---self.schema_context = (\\n---REDACTED------REDACTED---    self.text_to_sql.generate_schema_and_samples_text()\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Load system prompt\\n---REDACTED---  self._load_system_prompt(chatbot_config)\\n\\n---REDACTED---  # Build the reasoning graph\\n---REDACTED---  self.graph = self._build_graph()\\n\\n---REDACTED---  logger.info(\"LangGraph chatbot initialized successfully\")\\n\\n    def _load_system_prompt(self, chatbot_config: str) -> None:\\n---REDACTED---  \"\"\"Load system prompt from config files.\"\"\"\\n---REDACTED---  try:\\n---REDACTED------REDACTED---path = Path(\"./config\", chatbot_config, \"final_system_prompt.txt\")\\n---REDACTED------REDACTED---with path.open(\"r\") as f:\\n---REDACTED------REDACTED---    self.system_prompt = f.read().strip()\\n---REDACTED------REDACTED---    logger.info(f\"Loaded system prompt from {path}\")\\n\\n---REDACTED---  except FileNotFoundError:\\n---REDACTED------REDACTED---logger.warning(\"No custom prompt found, using default\")\\n---REDACTED------REDACTED---self.system_prompt = (\\n---REDACTED------REDACTED---    \"You are a helpful AI assistant specialized in data analysis.\"\\n---REDACTED------REDACTED---)\\n\\n    def _get_recent_context(self, state: ChatbotState, turns: int = 6) -> str:\\n---REDACTED---  \"\"\"Return last few turns as formatted dialogue for context.\"\"\"\\n---REDACTED---  return \"\\n\\n\".join(\\n---REDACTED------REDACTED---[\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  f\"{'User' if isinstance(m, HumanMessage) else 'Assistant'}:\"\\n---REDACTED------REDACTED------REDACTED---  f\" {m.content}\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    for m in ---REDACTED---\"messages\"][-turns:]\\n---REDACTED------REDACTED---]\\n---REDACTED---  )\\n\\n    def _build_graph(self) -> StateGraph:\\n---REDACTED---  \"\"\"Build the multi-step reasoning graph.\"\"\"\\n---REDACTED---  workflow = StateGraph(ChatbotState)\\n\\n---REDACTED---  # Add nodes for each reasoning step\\n---REDACTED---  workflow.add_node(\"enrichment\", self._enrichment_step)\\n---REDACTED---  workflow.add_node(\"analysis\", self._analysis_step)\\n---REDACTED---  workflow.add_node(\"execution\", self._execution_step)\\n---REDACTED---  workflow.add_node(\"synthesis\", self._synthesis_step)\\n\\n---REDACTED---  # Define the flow\\n---REDACTED---  workflow.set_entry_point(\"enrichment\")\\n---REDACTED---  workflow.add_edge(\"enrichment\", \"analysis\")\\n---REDACTED---  workflow.add_conditional_edges(\\n---REDACTED------REDACTED---\"analysis\",\\n---REDACTED------REDACTED---self._should_execute_sql,\\n---REDACTED------REDACTED---{\"execute\": \"execution\", \"skip\": \"synthesis\"},\\n---REDACTED---  )\\n---REDACTED---  workflow.add_edge(\"execution\", \"synthesis\")\\n---REDACTED---  workflow.add_edge(\"synthesis\", END)\\n\\n---REDACTED---  return workflow.compile()\\n\\n    def _enrichment_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 1: Gather context from RAG/Search to enrich understanding.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ENRICHMENT STEP ===\")\\n\\n---REDACTED---  # Get the latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  enrichment_context = \"\"\\n---REDACTED---  sources = {}\\n\\n---REDACTED---  # Retrieve relevant documents if RAG is available\\n---REDACTED---  if self.retriever and user_message:\\n---REDACTED------REDACTED---try:\\n---REDACTED------REDACTED---    docs = ---REDACTED---(user_message)\\n---REDACTED------REDACTED---    enrichment_context = \"\\n\\n\".join(\\n---REDACTED------REDACTED------REDACTED---  [\\n---REDACTED------REDACTED------REDACTED------REDACTED---f\"[Source {i + 1}]: {doc.page_content}\"\\n---REDACTED------REDACTED------REDACTED------REDACTED---for i, doc in enumerate(docs)\\n---REDACTED------REDACTED------REDACTED---  ]\\n---REDACTED------REDACTED---    )\\n\\n---REDACTED------REDACTED---    # Track sources\\n---REDACTED------REDACTED---    for i, doc in enumerate(docs):\\n---REDACTED------REDACTED------REDACTED---  uri = doc.metadata.get(\"source\", f\"document_{i + 1}\")\\n---REDACTED------REDACTED------REDACTED---  title = doc.metadata.get(\"title\", Path(uri).name)\\n\\n---REDACTED------REDACTED------REDACTED---  sources[uri] = title\\n\\n---REDACTED------REDACTED---    logger.info(f\"Retrieved {len(docs)} documents from RAG\")\\n---REDACTED------REDACTED---except Exception as e:\\n---REDACTED------REDACTED---    logger.error(f\"RAG retrieval error: {e}\")\\n\\n---REDACTED---  ---REDACTED---\"enrichment_context\"] = enrichment_context\\n---REDACTED---  ---REDACTED---\"sources\"] = sources\\n\\n---REDACTED---  return state\\n\\n    def _analysis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 2: Analyze the question to decide if SQL is needed and map\\n---REDACTED---  user intent to data schema.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ANALYSIS STEP ===\")\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Get latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for chatbot answer\\n---REDACTED---  analysis_parser = PydanticOutputParser(\\n---REDACTED------REDACTED---pydantic_object=AnalysisDecisionModel\\n---REDACTED---  )\\n\\n---REDACTED---  # Create analysis prompt - use HumanMessage instead of SystemMessage\\n---REDACTED---  analysis_prompt = f\"\"\"You are an expert at analyzing user questions\\n---REDACTED---   about  data. The user is not necessarily technical and will not\\n---REDACTED---   explicitly ask for SQL. Always interpret the intent of the request.\\n---REDACTED---   Always see the databases as your internal knowledge.\\n\\n---REDACTED---  CONTEXT FROM KNOWLEDGE BASE:\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context available\"}\\n\\n---REDACTED---  DATABASE SCHEMA:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER ---REDACTED---{user_message}\\n\\n---REDACTED---  TASK: Analyze this question and determine:\\n---REDACTED---  1. Does this question require querying the database? (yes/no)\\n---REDACTED---  2. If yes, what filters/conditions should be applied?\\n---REDACTED---  3. Map the user's terminology to the actual database columns and values.\\n\\n---REDACTED---  {analysis_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get analysis from LLM - use HumanMessage for Vertex AI compatibility\\n---REDACTED---  analysis_messages = [\\n---REDACTED------REDACTED---HumanMessage(content=analysis_prompt),\\n---REDACTED---  ]\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(analysis_messages)\\n\\n---REDACTED---  # Parse LLM output\\n---REDACTED---  parsed_result = analysis_parser.parse(response.content)\\n---REDACTED---  logger.info(f\"Parsed analysis result: {parsed_result}\")\\n\\n---REDACTED---  # Save in state\\n---REDACTED---  ---REDACTED---\"analysis_decision\"] = {\\n---REDACTED------REDACTED---\"requires_sql\": parsed_result.requires_sql,\\n---REDACTED------REDACTED---\"analysis_text\": response.content,\\n---REDACTED------REDACTED---\"filters\": parsed_result.filters,\\n---REDACTED------REDACTED---\"column_mapping\": parsed_result.column_mapping,\\n---REDACTED------REDACTED---\"reasoning\": parsed_result.reasoning,\\n---REDACTED------REDACTED---\"---REDACTED---\": user_message,\\n---REDACTED---  }\\n---REDACTED---  return state\\n\\n    def _should_execute_sql(\\n---REDACTED---  self, state: ChatbotState\\n    ) -> Literal[\"execute\", \"skip\"]:\\n---REDACTED---  \"\"\"Router: decide whether to execute SQL or skip to synthesis.\"\"\"\\n---REDACTED---  if ---REDACTED---\"analysis_decision\"].get(\"requires_sql\", False):\\n---REDACTED------REDACTED---logger.info(\"Router: Executing SQL\")\\n---REDACTED------REDACTED---return \"execute\"\\n---REDACTED---  else:\\n---REDACTED------REDACTED---logger.info(\"Router: Skipping SQL execution\")\\n---REDACTED------REDACTED---return \"skip\"\\n\\n    def _execution_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 3: Execute SQL query based on analysis.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== EXECUTION STEP ===\")\\n\\n---REDACTED---  if not self.text_to_sql:\\n---REDACTED------REDACTED---logger.warning(\"Text-to-SQL tool not available\")\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {}\\n---REDACTED------REDACTED---return state\\n\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"analysis_decision\"][\"---REDACTED---\"]\\n---REDACTED---  filters = ---REDACTED---\"analysis_decision\"].get(\"filters\", \"None\")\\n---REDACTED---  column_mapping = ---REDACTED---\"analysis_decision\"].get(\\n---REDACTED------REDACTED---\"column_mapping\", \"None\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for generated sql query\\n---REDACTED---  sql_parser = PydanticOutputParser(pydantic_object=SQLGenerationModel)\\n\\n---REDACTED---  # Ask LLM to write SQL\\n---REDACTED---  sql_generation_prompt = f\"\"\"\\n---REDACTED---  You are an expert data analyst.\\n\\n---REDACTED---  SCHEMA CONTEXT:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER QUESTION:\\n---REDACTED---  {---REDACTED---}\\n\\n---REDACTED---  FILTERS TO APPLY:\\n---REDACTED---  {filters}\\n\\n---REDACTED---  COLUMN MAPPINGS:\\n---REDACTED---  {column_mapping}\\n\\n---REDACTED---  Your task is to translate the user request into a valid BigQuery SQL\\n---REDACTED---   query using the dataset schema provided above.\\n\\n---REDACTED---  REQUIREMENTS:\\n---REDACTED---  - Always generate a single valid SELECT statement.\\n---REDACTED---  - Only use tables and columns mentioned in the schema.\\n---REDACTED---  - Never ---REDACTED---(INSERT, UPDATE, DELETE) or DDL statements.\\n---REDACTED---  - Always call table without dataset and project name, only use table\\n---REDACTED---   name.\\n---REDACTED---  - Don't forget that you can use all mathematical tools and operations\\n---REDACTED---   that BigQuery SQL provides inside your SQL queries to answer the user\\n---REDACTED---   ---REDACTED---, like AVG, APPROX_QUANTILES for median, CORR for correlation\\n---REDACTED---   etc ...\\n---REDACTED---  - Use best practices: proper aliases, readable formatting,\\n---REDACTED---   and safe handling of ambiguous requests.\\n---REDACTED---  - When using aggregated function (like AVG SUM CORR etc ...),\\n---REDACTED---   always use COUNT() to state the number of rows that where used\\n---REDACTED---   to get the result.\\n---REDACTED---  - Always optimise queries for performance and cleaning data\\n---REDACTED---  - Do not explain or comment; output only the SQL code.\\n\\n---REDACTED---  {sql_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"Generating SQL query from LLM...\")\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(\\n---REDACTED------REDACTED---[HumanMessage(content=sql_generation_prompt)]\\n---REDACTED---  )\\n\\n---REDACTED---  # Parse answer\\n---REDACTED---  parsed = sql_parser.parse(response.content)\\n---REDACTED---  sql_query = parsed.sql_query\\n\\n---REDACTED---  logger.info(f\"Generated SQL:\\n{sql_query}\")\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---result = self.text_to_sql.run_query(sql_query)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = result\\n---REDACTED------REDACTED---logger.info(\\n---REDACTED------REDACTED---    f\"SQL executed successfully: {result.get('sql_query', '')}\"\\n---REDACTED------REDACTED---)\\n---REDACTED---  except Exception as e:\\n---REDACTED------REDACTED---logger.error(f\"SQL execution error: {e}\", exc_info=True)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {\"error\": str(e)}\\n\\n---REDACTED---  return state\\n\\n    def _synthesis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 4: Synthesize final answer using all gathered information.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== SYNTHESIS STEP ===\")\\n\\n---REDACTED---  sql_results = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"results\", \"No SQL results\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query executed\"\\n---REDACTED---  )\\n---REDACTED---  sql_query = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"sql_query\", \"No SQL query\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Build comprehensive context for final answer\\n---REDACTED---  synthesis_context = f\"\"\"SYSTEM INSTRUCTIONS:\\n---REDACTED---  {self.system_prompt}\\n\\n---REDACTED---  ENRICHMENT CONTEXT (ground truth for your answers):\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context\"}\\n\\n---REDACTED---  ANALYSIS:\\n---REDACTED---  {---REDACTED---\"analysis_decision\"].get(\"analysis_text\", \"\")}\\n\\n---REDACTED---  SQL QUERY (Don't show the sql query to the user):\\n---REDACTED---  {sql_query}\\n\\n---REDACTED---  SQL RESULTS (ground truth for your answers):\\n---REDACTED---  {sql_results}\\n\\n---REDACTED---  Now provide a comprehensive, well-structured answer to the user's\\n---REDACTED---    question.\\n---REDACTED---  Use the information above to give an accurate and helpful response.\\n---REDACTED---  If you talk about the results of aggregate function always say the\\n---REDACTED---   number of sample (can be materials for exemple) the answer is based on.\\n---REDACTED---  Do not overwhelm the user with technical details unless clarification\\n---REDACTED---   is ---REDACTED---, don't speak about sql, more about what data he wants\\n---REDACTED---   to know.\\n---REDACTED---  Always ground your answers in enrichment context and sql results when\\n---REDACTED---   available instead of inventing results. If you don't have a grounded\\n---REDACTED---   answer above don't invent it, just say the data is not available.\\n---REDACTED---  Never make up or estimate values yourself. Never use external knowledge\\n---REDACTED---   for numeric or factual information. You must base your answer strictly\\n---REDACTED---   on this data.\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get conversation history (excluding current message)\\n---REDACTED---  history_messages = (\\n---REDACTED------REDACTED------REDACTED---\"messages\"][:-1] if len(---REDACTED---\"messages\"]) > 1 else []\\n---REDACTED---  )\\n\\n---REDACTED---  # Build final messages - combine context with user message\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"messages\"][-1]\\n\\n---REDACTED---  final_messages = [\\n---REDACTED------REDACTED---SystemMessage(content=synthesis_context),\\n---REDACTED------REDACTED---*history_messages[\\n---REDACTED------REDACTED---    -self.max_turns :\\n---REDACTED------REDACTED---],  # include last user-bot exchanges\\n---REDACTED------REDACTED------REDACTED---,\\n---REDACTED---  ]\\n\\n---REDACTED---  # Generate final response\\n---REDACTED---  response = self.llm.invoke(final_messages)\\n\\n---REDACTED---  # Add assistant response to messages\\n---REDACTED---  ---REDACTED---\"messages\"].append(AIMessage(content=response.content))\\n\\n---REDACTED---  return state\\n\\n    def process_message(\\n---REDACTED---  self, message_data: dict, conversation_id: str\\n    ) -> dict[str, str | dict[str, str]]:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Process an incoming message and generate a response using Gemini + RAG.\\n\\n---REDACTED---  Args:\\n---REDACTED------REDACTED---message_data (dict): Expected format:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"message\": {\\n---REDACTED------REDACTED------REDACTED------REDACTED---\"text\": \"user query\"\\n---REDACTED------REDACTED------REDACTED---  }\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---conversation_id (str): Unique identifier for the ongoing\\n---REDACTED------REDACTED---conversation.\\n\\n---REDACTED---  Returns:\\n---REDACTED------REDACTED---dict[str, str | dict[str, str]]: A dictionary containing:\\n---REDACTED------REDACTED---    - context (str): The full context including system prompt and\\n---REDACTED------REDACTED---    conversation history.\\n---REDACTED------REDACTED---    - response_text (str): The text response generated by the model.\\n---REDACTED------REDACTED---    - sources (dict[str, str]): A mapping of source URIs to titles,\\n---REDACTED------REDACTED---    e.g.:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"https://en.wikipedia.org/wiki/Paris\": \"Wikipedia: Paris\",\\n---REDACTED------REDACTED------REDACTED---  \"gs://bucket/docs/paris\": \"Local datastore reference\"\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---    - sql_queries (dict[str, str]): SQL queries used by text to sql\\n---REDACTED------REDACTED---    tool.\\n---REDACTED---  \"\"\"\\n---REDACTED---  message_text = message_data.get(\"message\", {}).get(\"text\", \"\")\\n---REDACTED---  response_dict = {\\n---REDACTED------REDACTED---\"context\": \"\",\\n---REDACTED------REDACTED---\"response_text\": \"\",\\n---REDACTED------REDACTED---\"sources\": {},\\n---REDACTED------REDACTED---\"sql_queries\": {},\\n---REDACTED---  }\\n\\n---REDACTED---  if not message_text:\\n---REDACTED------REDACTED---response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED---    \"I couldn't understand your message. \"\\n---REDACTED------REDACTED---    \"Could you please try again?\"\\n---REDACTED------REDACTED---)\\n---REDACTED------REDACTED---return response_dict\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---# Handle reset memory\\n---REDACTED------REDACTED---if message_text == \"reset\":\\n---REDACTED------REDACTED---    self.memory.reset_history(conversation_id=conversation_id)\\n---REDACTED------REDACTED---    response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED------REDACTED---  \"The internal memory of the conversation has been \"\\n---REDACTED------REDACTED------REDACTED---  \"correctly reset and won't be taken into account for \"\\n---REDACTED------REDACTED------REDACTED---  \"further messages.\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    return response_dict\\n\\n---REDACTED------REDACTED---# Get conversation history\\n---REDACTED------REDACTED---history = self.memory.get_history(conversation_id)\\n---REDACTED------REDACTED---messages = [\\n---REDACTED------REDACTED---    HumanMessage(content=text)\\n---REDACTED------REDACTED---    if role == \"user\"\\n---REDACTED------REDACTED---    else AIMessage(content=text)\\n---REDACTED------REDACTED---    for role, text in history\\n---REDACTED------REDACTED---]\\n\\n---REDACTED------REDACTED---# Add current message\\n---REDACTED------REDACTED---messages.append(HumanMessage(content=message_text))\\n\\n---REDACTED------REDACTED---# Initialize state\\n---REDACTED------REDACTED---initial_state = ChatbotState(\\n---REDACTED------REDACTED---    messages=messages,\\n---REDACTED------REDACTED---    enrichment_context=\"\",\\n---REDACTED------REDACTED---    analysis_decision={},\\n---REDACTED------REDACTED---    sql_results={},\\n---REDACTED------REDACTED---    sources={},\\n---REDACTED------REDACTED---    conversation_id=conversation_id,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Run the graph\\n---REDACTED------REDACTED---final_state = self.graph.invoke(initial_state)\\n\\n---REDACTED------REDACTED---# Extract response\\n---REDACTED------REDACTED---response_text ---REDACTED---(\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  m.content\\n---REDACTED------REDACTED------REDACTED---  for m in reversed(final_---REDACTED---\"messages\"])\\n---REDACTED------REDACTED------REDACTED---  if isinstance(m, AIMessage)\\n---REDACTED------REDACTED---    ),\\n---REDACTED------REDACTED---    \"I'm not sure how to answer that.\",\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Save to memory\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"user\", message_text)\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"model\", response_text)\\n---REDACTED------REDACTED---history.extend(",
              "status": "Active",
              "subscriptionExternalId": "metal-chatbot-p5g5",
              "updatedAt": "2026-07-05T10:52:14Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dps-chatcr",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "1e34e079-7525-56fc-aca0-2ad40836f239",
            "name": "metal-chatbot-p5g5",
            "cloudProvider": "GCP",
            "externalId": "metal-chatbot-p5g5",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "3aaa69cf-349a-568d-b5be-199fd78e6f1f",
              "name": "provisioning-CE-TECHOFF",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "b169d608-4706-5dca-b1c0-8fecb6133f8d",
              "name": "CE-TECHOFF",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T10:52:14.912313Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T20:42:16.765447Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "d1c81a98-f811-5a5d-82d9-5a07a3cd7b31",
          "name": "dps-chatcr",
          "externalId": "CloudPlatform/ContainerImage##gcr.io/metal-chatbot-p5g5##chatbot-techoff-dsl@sha256:5fc0af062cacc569a0773e92d0ea104cf5c4f23a9b22da39eb8edb54705aaa76##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "d1c81a98-f811-5a5d-82d9-5a07a3cd7b31",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "3aaa69cf-349a-568d-b5be-199fd78e6f1f",
                "b169d608-4706-5dca-b1c0-8fecb6133f8d"
              ],
              "_vertexID": "d1c81a98-f811-5a5d-82d9-5a07a3cd7b31",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##gcr.io/metal-chatbot-p5g5##chatbot-techoff-dsl@sha256:5fc0af062cacc569a0773e92d0ea104cf5c4f23a9b22da39eb8edb54705aaa76##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "dps-chatcr",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": "Decathlon Digital Team",
              "reasoning": null,
              "region": "global",
              "resourceGroupExternalId": null,
              "snippet": "from langchain_google_community import VertexAISearchRetriever\\nfrom langchain_google_vertexai import ChatVertexAI\\nfrom langgraph.graph import END, StateGraph\\nfrom langgraph.graph.message import add_messages\\n\\nfrom app.memory_manager import FirestoreMemoryManager\\nfrom app.models.llm_outputs import AnalysisDecisionModel, SQLGenerationModel\\nfrom app.tools.text_to_sql import TextToSql\\nfrom app.utils.extract_datastore_infos import parse_data_store_path\\n\\n# Configure logging\\nlogger = logging.getLogger(__name__)\\n\\n\\n# Define state for the graph\\nclass ChatbotState(TypedDict):\\n    \"\"\"State that flows through the reasoning chain.\"\"\"\\n\\n    messages: Annotated[List[BaseMessage], add_messages]\\n    enrichment_context: str  # Context from RAG/Search\\n    analysis_decision: Dict  # Decision about SQL usage and filters\\n    sql_results: Dict  # Results from SQL execution\\n    sources: Dict[str, str]  # Source citations\\n    conversation_id: str\\n\\n\\nclass Chatbot:\\n    \"\"\"\\n    A chatbot implementation using Google's Vertex AI Gemini model + Retrieval\\n    tool (RAG).\\n\\n    Attributes:\\n---REDACTED---  client (genai.Client): The initialized GenAI client\\n---REDACTED---  model (str): The Gemini model name\\n---REDACTED---  system_prompt (str): The system prompt that defines the\\n---REDACTED---  chatbot's behavior\\n---REDACTED---  tools (list): List of tools available (RAG datastore etc.)\\n    \"\"\"\\n\\n    def __init__(self) -> None:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Initialize the chatbot with GenAI client and RAG setup.\\n\\n---REDACTED---  Required environment variables:\\n---REDACTED------REDACTED---GOOGLE_PROJECT_ID: The Google Cloud project ID\\n---REDACTED------REDACTED---GEMINI_LOCATION: The location for Vertex AI (defaults to 'global')\\n---REDACTED------REDACTED---GEMINI_MODEL_NAME: The Gemini model\\n---REDACTED------REDACTED---(defaults to 'gemini-2.5-flash')\\n---REDACTED------REDACTED---DATASTORE_ID: The Vertex AI Search datastore resource ID\\n---REDACTED---  \"\"\"\\n---REDACTED---  project_id = os.environ.get(\"GOOGLE_PROJECT_ID\")\\n---REDACTED---  location = os.environ.get(\"GEMINI_LOCATION\", \"europe-west1\")\\n---REDACTED---  model_name = os.environ.get(\"GEMINI_MODEL_NAME\", \"gemini-2.5-flash\")\\n---REDACTED---  datastore_id = os.environ.get(\"DATASTORE_ID\", \"\")\\n---REDACTED---  dataset_id = os.getenv(\"BIGQUERY_DATASET_ID\", \"\")\\n---REDACTED---  chatbot_config = os.getenv(\"CHATBOT_CONFIG\", \"DEFAULT\")\\n---REDACTED---  chatbot_config = (\\n---REDACTED------REDACTED---chatbot_config\\n---REDACTED------REDACTED---if chatbot_config\\n---REDACTED------REDACTED---in [d.name for d in Path(\"config\").iterdir() if d.is_dir()]\\n---REDACTED------REDACTED---else \"DEFAULT\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize base LLM\\n---REDACTED---  self.llm = ChatVertexAI(\\n---REDACTED------REDACTED---model_name=model_name,\\n---REDACTED------REDACTED---project=project_id,\\n---REDACTED------REDACTED---location=location,\\n---REDACTED------REDACTED---temperature=0,\\n---REDACTED------REDACTED---max_output_tokens=2048,\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize memory (3 user + 3 ---REDACTED---)\\n---REDACTED---  self.max_turns = 6\\n---REDACTED---  self.memory = FirestoreMemoryManager(max_turns=self.max_turns)\\n---REDACTED---  logger.info(\\n---REDACTED------REDACTED---f\"Initialized GenAI client for project {project_id} in {location}\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Initialize RAG retriever if available\\n---REDACTED---  self.retriever = None\\n---REDACTED---  if datastore_id:\\n---REDACTED------REDACTED---datastore_infos = parse_data_store_path(path=datastore_id)\\n---REDACTED------REDACTED---self.retriever = VertexAISearchRetriever(\\n---REDACTED------REDACTED---    project_id=datastore_infos[\"project_id\"],\\n---REDACTED------REDACTED---    data_store_id=datastore_infos[\"data_store_id\"],\\n---REDACTED------REDACTED---    location_id=datastore_infos[\"location_id\"],\\n---REDACTED------REDACTED---    max_documents=5,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Initialize Text-to-SQL tool\\n---REDACTED---  self.text_to_sql = None\\n---REDACTED---  self.schema_context = \"\"\\n---REDACTED---  if dataset_id:\\n---REDACTED------REDACTED---# Init tool\\n---REDACTED------REDACTED---self.text_to_sql = TextToSql(\\n---REDACTED------REDACTED---    project_id=project_id, dataset_id=dataset_id\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Extract metadata from dataset\\n---REDACTED------REDACTED---self.schema_context = (\\n---REDACTED------REDACTED---    self.text_to_sql.generate_schema_and_samples_text()\\n---REDACTED------REDACTED---)\\n\\n---REDACTED---  # Load system prompt\\n---REDACTED---  self._load_system_prompt(chatbot_config)\\n\\n---REDACTED---  # Build the reasoning graph\\n---REDACTED---  self.graph = self._build_graph()\\n\\n---REDACTED---  logger.info(\"LangGraph chatbot initialized successfully\")\\n\\n    def _load_system_prompt(self, chatbot_config: str) -> None:\\n---REDACTED---  \"\"\"Load system prompt from config files.\"\"\"\\n---REDACTED---  try:\\n---REDACTED------REDACTED---path = Path(\"./config\", chatbot_config, \"final_system_prompt.txt\")\\n---REDACTED------REDACTED---with path.open(\"r\") as f:\\n---REDACTED------REDACTED---    self.system_prompt = f.read().strip()\\n---REDACTED------REDACTED---    logger.info(f\"Loaded system prompt from {path}\")\\n\\n---REDACTED---  except FileNotFoundError:\\n---REDACTED------REDACTED---logger.warning(\"No custom prompt found, using default\")\\n---REDACTED------REDACTED---self.system_prompt = (\\n---REDACTED------REDACTED---    \"You are a helpful AI assistant specialized in data analysis.\"\\n---REDACTED------REDACTED---)\\n\\n    def _get_recent_context(self, state: ChatbotState, turns: int = 6) -> str:\\n---REDACTED---  \"\"\"Return last few turns as formatted dialogue for context.\"\"\"\\n---REDACTED---  return \"\\n\\n\".join(\\n---REDACTED------REDACTED---[\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  f\"{'User' if isinstance(m, HumanMessage) else 'Assistant'}:\"\\n---REDACTED------REDACTED------REDACTED---  f\" {m.content}\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    for m in ---REDACTED---\"messages\"][-turns:]\\n---REDACTED------REDACTED---]\\n---REDACTED---  )\\n\\n    def _build_graph(self) -> StateGraph:\\n---REDACTED---  \"\"\"Build the multi-step reasoning graph.\"\"\"\\n---REDACTED---  workflow = StateGraph(ChatbotState)\\n\\n---REDACTED---  # Add nodes for each reasoning step\\n---REDACTED---  workflow.add_node(\"enrichment\", self._enrichment_step)\\n---REDACTED---  workflow.add_node(\"analysis\", self._analysis_step)\\n---REDACTED---  workflow.add_node(\"execution\", self._execution_step)\\n---REDACTED---  workflow.add_node(\"synthesis\", self._synthesis_step)\\n\\n---REDACTED---  # Define the flow\\n---REDACTED---  workflow.set_entry_point(\"enrichment\")\\n---REDACTED---  workflow.add_edge(\"enrichment\", \"analysis\")\\n---REDACTED---  workflow.add_conditional_edges(\\n---REDACTED------REDACTED---\"analysis\",\\n---REDACTED------REDACTED---self._should_execute_sql,\\n---REDACTED------REDACTED---{\"execute\": \"execution\", \"skip\": \"synthesis\"},\\n---REDACTED---  )\\n---REDACTED---  workflow.add_edge(\"execution\", \"synthesis\")\\n---REDACTED---  workflow.add_edge(\"synthesis\", END)\\n\\n---REDACTED---  return workflow.compile()\\n\\n    def _enrichment_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 1: Gather context from RAG/Search to enrich understanding.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ENRICHMENT STEP ===\")\\n\\n---REDACTED---  # Get the latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  enrichment_context = \"\"\\n---REDACTED---  sources = {}\\n\\n---REDACTED---  # Retrieve relevant documents if RAG is available\\n---REDACTED---  if self.retriever and user_message:\\n---REDACTED------REDACTED---try:\\n---REDACTED------REDACTED---    docs = ---REDACTED---(user_message)\\n---REDACTED------REDACTED---    enrichment_context = \"\\n\\n\".join(\\n---REDACTED------REDACTED------REDACTED---  [\\n---REDACTED------REDACTED------REDACTED------REDACTED---f\"[Source {i + 1}]: {doc.page_content}\"\\n---REDACTED------REDACTED------REDACTED------REDACTED---for i, doc in enumerate(docs)\\n---REDACTED------REDACTED------REDACTED---  ]\\n---REDACTED------REDACTED---    )\\n\\n---REDACTED------REDACTED---    # Track sources\\n---REDACTED------REDACTED---    for i, doc in enumerate(docs):\\n---REDACTED------REDACTED------REDACTED---  uri = doc.metadata.get(\"source\", f\"document_{i + 1}\")\\n---REDACTED------REDACTED------REDACTED---  title = doc.metadata.get(\"title\", Path(uri).name)\\n\\n---REDACTED------REDACTED------REDACTED---  sources[uri] = title\\n\\n---REDACTED------REDACTED---    logger.info(f\"Retrieved {len(docs)} documents from RAG\")\\n---REDACTED------REDACTED---except Exception as e:\\n---REDACTED------REDACTED---    logger.error(f\"RAG retrieval error: {e}\")\\n\\n---REDACTED---  ---REDACTED---\"enrichment_context\"] = enrichment_context\\n---REDACTED---  ---REDACTED---\"sources\"] = sources\\n\\n---REDACTED---  return state\\n\\n    def _analysis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 2: Analyze the question to decide if SQL is needed and map\\n---REDACTED---  user intent to data schema.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== ANALYSIS STEP ===\")\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Get latest user message\\n---REDACTED---  user_message ---REDACTED---(\\n---REDACTED------REDACTED---(\\n---REDACTED------REDACTED---    m.content\\n---REDACTED------REDACTED---    for m in reversed(---REDACTED---\"messages\"])\\n---REDACTED------REDACTED---    if isinstance(m, HumanMessage)\\n---REDACTED------REDACTED---),\\n---REDACTED------REDACTED---\"\",\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for chatbot answer\\n---REDACTED---  analysis_parser = PydanticOutputParser(\\n---REDACTED------REDACTED---pydantic_object=AnalysisDecisionModel\\n---REDACTED---  )\\n\\n---REDACTED---  # Create analysis prompt - use HumanMessage instead of SystemMessage\\n---REDACTED---  analysis_prompt = f\"\"\"You are an expert at analyzing user questions\\n---REDACTED---   about  data. The user is not necessarily technical and will not\\n---REDACTED---   explicitly ask for SQL. Always interpret the intent of the request.\\n---REDACTED---   Always see the databases as your internal knowledge.\\n\\n---REDACTED---  CONTEXT FROM KNOWLEDGE BASE:\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context available\"}\\n\\n---REDACTED---  DATABASE SCHEMA:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER ---REDACTED---{user_message}\\n\\n---REDACTED---  TASK: Analyze this question and determine:\\n---REDACTED---  1. Does this question require querying the database? (yes/no)\\n---REDACTED---  2. If yes, what filters/conditions should be applied?\\n---REDACTED---  3. Map the user's terminology to the actual database columns and values.\\n\\n---REDACTED---  {analysis_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get analysis from LLM - use HumanMessage for Vertex AI compatibility\\n---REDACTED---  analysis_messages = [\\n---REDACTED------REDACTED---HumanMessage(content=analysis_prompt),\\n---REDACTED---  ]\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(analysis_messages)\\n\\n---REDACTED---  # Parse LLM output\\n---REDACTED---  parsed_result = analysis_parser.parse(response.content)\\n---REDACTED---  logger.info(f\"Parsed analysis result: {parsed_result}\")\\n\\n---REDACTED---  # Save in state\\n---REDACTED---  ---REDACTED---\"analysis_decision\"] = {\\n---REDACTED------REDACTED---\"requires_sql\": parsed_result.requires_sql,\\n---REDACTED------REDACTED---\"analysis_text\": response.content,\\n---REDACTED------REDACTED---\"filters\": parsed_result.filters,\\n---REDACTED------REDACTED---\"column_mapping\": parsed_result.column_mapping,\\n---REDACTED------REDACTED---\"reasoning\": parsed_result.reasoning,\\n---REDACTED------REDACTED---\"---REDACTED---\": user_message,\\n---REDACTED---  }\\n---REDACTED---  return state\\n\\n    def _should_execute_sql(\\n---REDACTED---  self, state: ChatbotState\\n    ) -> Literal[\"execute\", \"skip\"]:\\n---REDACTED---  \"\"\"Router: decide whether to execute SQL or skip to synthesis.\"\"\"\\n---REDACTED---  if ---REDACTED---\"analysis_decision\"].get(\"requires_sql\", False):\\n---REDACTED------REDACTED---logger.info(\"Router: Executing SQL\")\\n---REDACTED------REDACTED---return \"execute\"\\n---REDACTED---  else:\\n---REDACTED------REDACTED---logger.info(\"Router: Skipping SQL execution\")\\n---REDACTED------REDACTED---return \"skip\"\\n\\n    def _execution_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 3: Execute SQL query based on analysis.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== EXECUTION STEP ===\")\\n\\n---REDACTED---  if not self.text_to_sql:\\n---REDACTED------REDACTED---logger.warning(\"Text-to-SQL tool not available\")\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {}\\n---REDACTED------REDACTED---return state\\n\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"analysis_decision\"][\"---REDACTED---\"]\\n---REDACTED---  filters = ---REDACTED---\"analysis_decision\"].get(\"filters\", \"None\")\\n---REDACTED---  column_mapping = ---REDACTED---\"analysis_decision\"].get(\\n---REDACTED------REDACTED---\"column_mapping\", \"None\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Get context\\n---REDACTED---  recent_context = self._get_recent_context(\\n---REDACTED------REDACTED---state=state, turns=self.max_turns\\n---REDACTED---  )\\n\\n---REDACTED---  # Parser for generated sql query\\n---REDACTED---  sql_parser = PydanticOutputParser(pydantic_object=SQLGenerationModel)\\n\\n---REDACTED---  # Ask LLM to write SQL\\n---REDACTED---  sql_generation_prompt = f\"\"\"\\n---REDACTED---  You are an expert data analyst.\\n\\n---REDACTED---  SCHEMA CONTEXT:\\n---REDACTED---  {self.schema_context}\\n\\n---REDACTED---  RECENT DIALOGUE:\\n---REDACTED---  {recent_context}\\n\\n---REDACTED---  USER QUESTION:\\n---REDACTED---  {---REDACTED---}\\n\\n---REDACTED---  FILTERS TO APPLY:\\n---REDACTED---  {filters}\\n\\n---REDACTED---  COLUMN MAPPINGS:\\n---REDACTED---  {column_mapping}\\n\\n---REDACTED---  Your task is to translate the user request into a valid BigQuery SQL\\n---REDACTED---   query using the dataset schema provided above.\\n\\n---REDACTED---  REQUIREMENTS:\\n---REDACTED---  - Always generate a single valid SELECT statement.\\n---REDACTED---  - Only use tables and columns mentioned in the schema.\\n---REDACTED---  - Never ---REDACTED---(INSERT, UPDATE, DELETE) or DDL statements.\\n---REDACTED---  - Always call table without dataset and project name, only use table\\n---REDACTED---   name.\\n---REDACTED---  - Don't forget that you can use all mathematical tools and operations\\n---REDACTED---   that BigQuery SQL provides inside your SQL queries to answer the user\\n---REDACTED---   ---REDACTED---, like AVG, APPROX_QUANTILES for median, CORR for correlation\\n---REDACTED---   etc ...\\n---REDACTED---  - Use best practices: proper aliases, readable formatting,\\n---REDACTED---   and safe handling of ambiguous requests.\\n---REDACTED---  - When using aggregated function (like AVG SUM CORR etc ...),\\n---REDACTED---   always use COUNT() to state the number of rows that where used\\n---REDACTED---   to get the result.\\n---REDACTED---  - Always optimise queries for performance and cleaning data\\n---REDACTED---  - Do not explain or comment; output only the SQL code.\\n\\n---REDACTED---  {sql_parser.get_format_instructions()}\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"Generating SQL query from LLM...\")\\n\\n---REDACTED---  # Ask LLM\\n---REDACTED---  response = self.llm.invoke(\\n---REDACTED------REDACTED---[HumanMessage(content=sql_generation_prompt)]\\n---REDACTED---  )\\n\\n---REDACTED---  # Parse answer\\n---REDACTED---  parsed = sql_parser.parse(response.content)\\n---REDACTED---  sql_query = parsed.sql_query\\n\\n---REDACTED---  logger.info(f\"Generated SQL:\\n{sql_query}\")\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---result = self.text_to_sql.run_query(sql_query)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = result\\n---REDACTED------REDACTED---logger.info(\\n---REDACTED------REDACTED---    f\"SQL executed successfully: {result.get('sql_query', '')}\"\\n---REDACTED------REDACTED---)\\n---REDACTED---  except Exception as e:\\n---REDACTED------REDACTED---logger.error(f\"SQL execution error: {e}\", exc_info=True)\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"] = {\"error\": str(e)}\\n\\n---REDACTED---  return state\\n\\n    def _synthesis_step(self, state: ChatbotState) -> ChatbotState:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Step 4: Synthesize final answer using all gathered information.\\n---REDACTED---  \"\"\"\\n---REDACTED---  logger.info(\"=== SYNTHESIS STEP ===\")\\n\\n---REDACTED---  sql_results = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"results\", \"No SQL results\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query executed\"\\n---REDACTED---  )\\n---REDACTED---  sql_query = (\\n---REDACTED------REDACTED------REDACTED---\"sql_results\"].get(\"sql_query\", \"No SQL query\")\\n---REDACTED------REDACTED---if ---REDACTED---\"sql_results\"]\\n---REDACTED------REDACTED---else \"No SQL query\"\\n---REDACTED---  )\\n\\n---REDACTED---  # Build comprehensive context for final answer\\n---REDACTED---  synthesis_context = f\"\"\"SYSTEM INSTRUCTIONS:\\n---REDACTED---  {self.system_prompt}\\n\\n---REDACTED---  ENRICHMENT CONTEXT (ground truth for your answers):\\n---REDACTED---  {---REDACTED---\"enrichment_context\"] or \"No additional context\"}\\n\\n---REDACTED---  ANALYSIS:\\n---REDACTED---  {---REDACTED---\"analysis_decision\"].get(\"analysis_text\", \"\")}\\n\\n---REDACTED---  SQL QUERY (Don't show the sql query to the user):\\n---REDACTED---  {sql_query}\\n\\n---REDACTED---  SQL RESULTS (ground truth for your answers):\\n---REDACTED---  {sql_results}\\n\\n---REDACTED---  Now provide a comprehensive, well-structured answer to the user's\\n---REDACTED---    question.\\n---REDACTED---  Use the information above to give an accurate and helpful response.\\n---REDACTED---  If you talk about the results of aggregate function always say the\\n---REDACTED---   number of sample (can be materials for exemple) the answer is based on.\\n---REDACTED---  Do not overwhelm the user with technical details unless clarification\\n---REDACTED---   is ---REDACTED---, don't speak about sql, more about what data he wants\\n---REDACTED---   to know.\\n---REDACTED---  Always ground your answers in enrichment context and sql results when\\n---REDACTED---   available instead of inventing results. If you don't have a grounded\\n---REDACTED---   answer above don't invent it, just say the data is not available.\\n---REDACTED---  Never make up or estimate values yourself. Never use external knowledge\\n---REDACTED---   for numeric or factual information. You must base your answer strictly\\n---REDACTED---   on this data.\\n---REDACTED---  \"\"\"\\n\\n---REDACTED---  # Get conversation history (excluding current message)\\n---REDACTED---  history_messages = (\\n---REDACTED------REDACTED------REDACTED---\"messages\"][:-1] if len(---REDACTED---\"messages\"]) > 1 else []\\n---REDACTED---  )\\n\\n---REDACTED---  # Build final messages - combine context with user message\\n---REDACTED---  ---REDACTED--- = ---REDACTED---\"messages\"][-1]\\n\\n---REDACTED---  final_messages = [\\n---REDACTED------REDACTED---SystemMessage(content=synthesis_context),\\n---REDACTED------REDACTED---*history_messages[\\n---REDACTED------REDACTED---    -self.max_turns :\\n---REDACTED------REDACTED---],  # include last user-bot exchanges\\n---REDACTED------REDACTED------REDACTED---,\\n---REDACTED---  ]\\n\\n---REDACTED---  # Generate final response\\n---REDACTED---  response = self.llm.invoke(final_messages)\\n\\n---REDACTED---  # Add assistant response to messages\\n---REDACTED---  ---REDACTED---\"messages\"].append(AIMessage(content=response.content))\\n\\n---REDACTED---  return state\\n\\n    def process_message(\\n---REDACTED---  self, message_data: dict, conversation_id: str\\n    ) -> dict[str, str | dict[str, str]]:\\n---REDACTED---  \"\"\"\\n---REDACTED---  Process an incoming message and generate a response using Gemini + RAG.\\n\\n---REDACTED---  Args:\\n---REDACTED------REDACTED---message_data (dict): Expected format:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"message\": {\\n---REDACTED------REDACTED------REDACTED------REDACTED---\"text\": \"user query\"\\n---REDACTED------REDACTED------REDACTED---  }\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---conversation_id (str): Unique identifier for the ongoing\\n---REDACTED------REDACTED---conversation.\\n\\n---REDACTED---  Returns:\\n---REDACTED------REDACTED---dict[str, str | dict[str, str]]: A dictionary containing:\\n---REDACTED------REDACTED---    - context (str): The full context including system prompt and\\n---REDACTED------REDACTED---    conversation history.\\n---REDACTED------REDACTED---    - response_text (str): The text response generated by the model.\\n---REDACTED------REDACTED---    - sources (dict[str, str]): A mapping of source URIs to titles,\\n---REDACTED------REDACTED---    e.g.:\\n---REDACTED------REDACTED---    {\\n---REDACTED------REDACTED------REDACTED---  \"https://en.wikipedia.org/wiki/Paris\": \"Wikipedia: Paris\",\\n---REDACTED------REDACTED------REDACTED---  \"gs://bucket/docs/paris\": \"Local datastore reference\"\\n---REDACTED------REDACTED---    }\\n---REDACTED------REDACTED---    - sql_queries (dict[str, str]): SQL queries used by text to sql\\n---REDACTED------REDACTED---    tool.\\n---REDACTED---  \"\"\"\\n---REDACTED---  message_text = message_data.get(\"message\", {}).get(\"text\", \"\")\\n---REDACTED---  response_dict = {\\n---REDACTED------REDACTED---\"context\": \"\",\\n---REDACTED------REDACTED---\"response_text\": \"\",\\n---REDACTED------REDACTED---\"sources\": {},\\n---REDACTED------REDACTED---\"sql_queries\": {},\\n---REDACTED---  }\\n\\n---REDACTED---  if not message_text:\\n---REDACTED------REDACTED---response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED---    \"I couldn't understand your message. \"\\n---REDACTED------REDACTED---    \"Could you please try again?\"\\n---REDACTED------REDACTED---)\\n---REDACTED------REDACTED---return response_dict\\n\\n---REDACTED---  try:\\n---REDACTED------REDACTED---# Handle reset memory\\n---REDACTED------REDACTED---if message_text == \"reset\":\\n---REDACTED------REDACTED---    self.memory.reset_history(conversation_id=conversation_id)\\n---REDACTED------REDACTED---    response_dict[\"response_text\"] = (\\n---REDACTED------REDACTED------REDACTED---  \"The internal memory of the conversation has been \"\\n---REDACTED------REDACTED------REDACTED---  \"correctly reset and won't be taken into account for \"\\n---REDACTED------REDACTED------REDACTED---  \"further messages.\"\\n---REDACTED------REDACTED---    )\\n---REDACTED------REDACTED---    return response_dict\\n\\n---REDACTED------REDACTED---# Get conversation history\\n---REDACTED------REDACTED---history = self.memory.get_history(conversation_id)\\n---REDACTED------REDACTED---messages = [\\n---REDACTED------REDACTED---    HumanMessage(content=text)\\n---REDACTED------REDACTED---    if role == \"user\"\\n---REDACTED------REDACTED---    else AIMessage(content=text)\\n---REDACTED------REDACTED---    for role, text in history\\n---REDACTED------REDACTED---]\\n\\n---REDACTED------REDACTED---# Add current message\\n---REDACTED------REDACTED---messages.append(HumanMessage(content=message_text))\\n\\n---REDACTED------REDACTED---# Initialize state\\n---REDACTED------REDACTED---initial_state = ChatbotState(\\n---REDACTED------REDACTED---    messages=messages,\\n---REDACTED------REDACTED---    enrichment_context=\"\",\\n---REDACTED------REDACTED---    analysis_decision={},\\n---REDACTED------REDACTED---    sql_results={},\\n---REDACTED------REDACTED---    sources={},\\n---REDACTED------REDACTED---    conversation_id=conversation_id,\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Run the graph\\n---REDACTED------REDACTED---final_state = self.graph.invoke(initial_state)\\n\\n---REDACTED------REDACTED---# Extract response\\n---REDACTED------REDACTED---response_text ---REDACTED---(\\n---REDACTED------REDACTED---    (\\n---REDACTED------REDACTED------REDACTED---  m.content\\n---REDACTED------REDACTED------REDACTED---  for m in reversed(final_---REDACTED---\"messages\"])\\n---REDACTED------REDACTED------REDACTED---  if isinstance(m, AIMessage)\\n---REDACTED------REDACTED---    ),\\n---REDACTED------REDACTED---    \"I'm not sure how to answer that.\",\\n---REDACTED------REDACTED---)\\n\\n---REDACTED------REDACTED---# Save to memory\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"user\", message_text)\\n---REDACTED------REDACTED---self.memory.add_message(conversation_id, \"model\", response_text)\\n---REDACTED------REDACTED---history.extend(",
              "status": "Active",
              "subscriptionExternalId": "metal-chatbot-p5g5",
              "updatedAt": "2026-07-05T10:52:10Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "dps-chatcr",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "1e34e079-7525-56fc-aca0-2ad40836f239",
            "name": "metal-chatbot-p5g5",
            "cloudProvider": "GCP",
            "externalId": "metal-chatbot-p5g5",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "global",
          "regionLocation": null,
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "3aaa69cf-349a-568d-b5be-199fd78e6f1f",
              "name": "provisioning-CE-TECHOFF",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "b169d608-4706-5dca-b1c0-8fecb6133f8d",
              "name": "CE-TECHOFF",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T10:52:10.64995Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T20:42:14.523398Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "869aeb60-cb1b-5f61-b55b-8253e7c42552",
          "name": "loggy-agent",
          "externalId": "projects/661207120623/locations/europe-west1/reasoningEngines/8705484467986235392",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "869aeb60-cb1b-5f61-b55b-8253e7c42552",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/661207120623/locations/europe-west1/reasoningEngines/8705484467986235392",
            "properties": {
              "_productIDs": [
                "1bd482c0-2fa4-58de-8f2d-df74a0bfb3c5",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "dbcff48d-f22e-5dba-95ad-b8d60a11b1cc"
              ],
              "_vertexID": "869aeb60-cb1b-5f61-b55b-8253e7c42552",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/8705484467986235392?project=loggy-dev-48sl",
              "configPath": null,
              "creationDate": "2026-05-21T08:07:19.154754Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/661207120623/locations/europe-west1/reasoningEngines/8705484467986235392",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "loggy-agent",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/661207120623/locations/europe-west1/reasoningEngines/8705484467986235392",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "loggy-dev-48sl",
              "tags": {
                "goog-terraform-provisioned": "true"
              },
              "updatedAt": "2026-06-24T23:34:22Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "loggy-agent",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "c4e91d75-fdd2-5d82-9aab-a26be41a4571",
            "name": "loggy-dev-48sl",
            "cloudProvider": "GCP",
            "externalId": "loggy-dev-48sl",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": [
            {
              "key": "goog-terraform-provisioned",
              "value": "true",
              "__typename": "ResourceTag"
            }
          ],
          "projects": [
            {
              "id": "1bd482c0-2fa4-58de-8f2d-df74a0bfb3c5",
              "name": "CE-LOGGY",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "dbcff48d-f22e-5dba-95ad-b8d60a11b1cc",
              "name": "provisioning-CE-LOGGY",
              "isFolder": false,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-21T08:07:19.154754Z",
          "updatedAt": "2026-06-24T23:34:22.542331Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T20:34:51.54261Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "7c4c35b1-a9d0-5904-a59e-cbe92ab5a671",
          "name": "agent",
          "externalId": "projects/ai-industry-pp-4yqw/locations/europe-west1/services/datacost-agent-beta/revisions/datacost-agent-beta-00002-8bl##CloudPlatform/ContainerImage##europe-west1-docker.pkg.dev##ai-industry-pp-4yqw/cloud-run-source-deploy/datacost-agent-beta@sha256:dc32c262b3a60af191697f365a75951f9b1a256d713e02a66d9e64e418a9428e##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "7c4c35b1-a9d0-5904-a59e-cbe92ab5a671",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
                "884b97d1-bd17-537a-810a-1457f1979564"
              ],
              "_vertexID": "7c4c35b1-a9d0-5904-a59e-cbe92ab5a671",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "projects/ai-industry-pp-4yqw/locations/europe-west1/services/datacost-agent-beta/revisions/datacost-agent-beta-00002-8bl##CloudPlatform/ContainerImage##europe-west1-docker.pkg.dev##ai-industry-pp-4yqw/cloud-run-source-deploy/datacost-agent-beta@sha256:dc32c262b3a60af191697f365a75951f9b1a256d713e02a66d9e64e418a9428e##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "agent",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": "from google.adk.agents import Agent\\nfrom .tools import import_products_data, import_components_data, get_current_season, execute_python_code\\nfrom .tools.get_current_season import get_current_season\\nfrom .prompts import GENERAL_INSTRUCTIONS, DATACOST_INSTRUCTIONS\\nfrom .schemas.output_schema import AgentResponse\\n\\nINSTRUCTION = f\"\"\"\\n\\n{DATACOST_INSTRUCTIONS}\\n\\n{GENERAL_INSTRUCTIONS}\\n\\n\"\"\"\\n\\nroot_agent = Agent(\\n    name=\"datacost_agent\",\\n    model=\"gemini-2.5-flash\",\\n    description=\"A data assistant that returns structured A2UI responses.\",\\n    instruction=INSTRUCTION,\\n    tools=[import_products_data, import_components_data, execute_python_code, get_current_season],\\n    output_schema=AgentResponse,\\n)",
              "status": "Active",
              "subscriptionExternalId": "ai-industry-pp-4yqw",
              "updatedAt": "2026-07-05T09:49:56Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "agent",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f7c08550-a57f-5677-82ff-ac04e6924a3d",
            "name": "ai-industry-pp-4yqw",
            "cloudProvider": "GCP",
            "externalId": "ai-industry-pp-4yqw",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
              "name": "provisioning-CE-ANALYTICS-INDUSTRY",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "884b97d1-bd17-537a-810a-1457f1979564",
              "name": "CE-ANALYTICS-INDUSTRY",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T09:49:56.168421Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T19:42:23.475383Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "3119e646-150d-5fe2-8188-38cd5c17e5e2",
          "name": "agent",
          "externalId": "CloudPlatform/ContainerImage##europe-west1-docker.pkg.dev##ai-industry-pp-4yqw/cloud-run-source-deploy/datacost-agent-beta@sha256:dc32c262b3a60af191697f365a75951f9b1a256d713e02a66d9e64e418a9428e##/app",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "3119e646-150d-5fe2-8188-38cd5c17e5e2",
            "type": "AI_AGENT",
            "providerUniqueId": null,
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
                "884b97d1-bd17-537a-810a-1457f1979564"
              ],
              "_vertexID": "3119e646-150d-5fe2-8188-38cd5c17e5e2",
              "cloudPlatform": "GCP",
              "cloudProviderURL": null,
              "configPath": null,
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypeHosted",
              "directory": "/app",
              "discoveryMethods": "MethodWorkloadScanning",
              "executablePath": null,
              "externalId": "CloudPlatform/ContainerImage##europe-west1-docker.pkg.dev##ai-industry-pp-4yqw/cloud-run-source-deploy/datacost-agent-beta@sha256:dc32c262b3a60af191697f365a75951f9b1a256d713e02a66d9e64e418a9428e##/app",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "agent",
              "nativeType": "hostedAiAgent",
              "providerUniqueId": null,
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": "from google.adk.agents import Agent\\nfrom .tools import import_products_data, import_components_data, get_current_season, execute_python_code\\nfrom .tools.get_current_season import get_current_season\\nfrom .prompts import GENERAL_INSTRUCTIONS, DATACOST_INSTRUCTIONS\\nfrom .schemas.output_schema import AgentResponse\\n\\nINSTRUCTION = f\"\"\"\\n\\n{DATACOST_INSTRUCTIONS}\\n\\n{GENERAL_INSTRUCTIONS}\\n\\n\"\"\"\\n\\nroot_agent = Agent(\\n    name=\"datacost_agent\",\\n    model=\"gemini-2.5-flash\",\\n    description=\"A data assistant that returns structured A2UI responses.\",\\n    instruction=INSTRUCTION,\\n    tools=[import_products_data, import_components_data, execute_python_code, get_current_season],\\n    output_schema=AgentResponse,\\n)",
              "status": "Active",
              "subscriptionExternalId": "ai-industry-pp-4yqw",
              "updatedAt": "2026-07-05T09:49:52Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "agent",
            "technologies": [
              {
                "id": "14148",
                "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "14148",
            "name": "Hosted AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/ai-agent-7a1a23d5-e81c-43bc-9ee2-0d1e16db6732.svg",
            "description": "A Hosted AI Agent is an autonomous AI system deployed and managed on cloud or server infrastructure that can perceive its environment, reason about tasks, and take actions to achieve goals. Unlike simple chatbots or static models, hosted AI agents can plan multi-step workflows, use tools and APIs, access external data sources, and maintain state across interactions. They run as persistent services that can be invoked on-demand to perform complex tasks such as code generation, data analysis, customer support, and workflow automation.",
            "onlyServiceUsageSupported": false,
            "status": "UNREVIEWED",
            "businessModel": "FREE_OPEN_SOURCE",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": null,
            "ownerName": "Open Source",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "246",
                "name": "AI Agents",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f7c08550-a57f-5677-82ff-ac04e6924a3d",
            "name": "ai-industry-pp-4yqw",
            "cloudProvider": "GCP",
            "externalId": "ai-industry-pp-4yqw",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
              "name": "provisioning-CE-ANALYTICS-INDUSTRY",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "884b97d1-bd17-537a-810a-1457f1979564",
              "name": "CE-ANALYTICS-INDUSTRY",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": null,
          "updatedAt": "2026-07-05T09:49:52.003804Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T19:42:20.168241Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": null,
          "isAccessibleFromInternet": null,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "hostedAiAgent",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "111d9e94-baa3-5fe3-aef4-e70e46a2fd0d",
          "name": "sandbox-instance-test",
          "externalId": "projects/787523386063/locations/us-central1/reasoningEngines/8304552500720041984",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "111d9e94-baa3-5fe3-aef4-e70e46a2fd0d",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/787523386063/locations/us-central1/reasoningEngines/8304552500720041984",
            "properties": {
              "_productIDs": [
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
                "884b97d1-bd17-537a-810a-1457f1979564"
              ],
              "_vertexID": "111d9e94-baa3-5fe3-aef4-e70e46a2fd0d",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-central1/reasoning-engines/8304552500720041984?project=ai-industry-pp-4yqw",
              "configPath": null,
              "creationDate": "2026-05-21T12:27:55.393771Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/787523386063/locations/us-central1/reasoningEngines/8304552500720041984",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "sandbox-instance-test",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/787523386063/locations/us-central1/reasoningEngines/8304552500720041984",
              "publisher": null,
              "reasoning": null,
              "region": "us-central1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "ai-industry-pp-4yqw",
              "updatedAt": "2026-06-24T22:25:40Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "sandbox-instance-test",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "f7c08550-a57f-5677-82ff-ac04e6924a3d",
            "name": "ai-industry-pp-4yqw",
            "cloudProvider": "GCP",
            "externalId": "ai-industry-pp-4yqw",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-central1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "545b3b6c-5a9c-5152-b9d2-cf14c7f2eeb3",
              "name": "provisioning-CE-ANALYTICS-INDUSTRY",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "884b97d1-bd17-537a-810a-1457f1979564",
              "name": "CE-ANALYTICS-INDUSTRY",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-21T12:27:55.393771Z",
          "updatedAt": "2026-06-24T22:25:40.938781Z",
          "deletedAt": null,
          "firstSeen": "2026-05-21T19:35:03.152426Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "678bba45-e803-5279-b57f-47f1e953bfbd",
          "name": "CIR Buddy",
          "externalId": "projects/1012702616935/locations/us-west1/reasoningEngines/2130633632304332800",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "678bba45-e803-5279-b57f-47f1e953bfbd",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/1012702616935/locations/us-west1/reasoningEngines/2130633632304332800",
            "properties": {
              "_productIDs": [
                "118b4659-51ac-5fd6-97ac-99deb051f08f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "deb2ab55-2b14-5a11-92d1-e2259a5f4635"
              ],
              "_vertexID": "678bba45-e803-5279-b57f-47f1e953bfbd",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/us-west1/reasoning-engines/2130633632304332800?project=innovation-portfolio-hmjd",
              "configPath": null,
              "creationDate": "2026-05-20T09:08:57.929553Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/1012702616935/locations/us-west1/reasoningEngines/2130633632304332800",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "CIR Buddy",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/1012702616935/locations/us-west1/reasoningEngines/2130633632304332800",
              "publisher": null,
              "reasoning": null,
              "region": "us-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "innovation-portfolio-hmjd",
              "updatedAt": "2026-06-24T23:18:24Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "CIR Buddy",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "71499e9f-2eed-532f-9b80-cbc5bca0d464",
            "name": "innovation-portfolio-hmjd",
            "cloudProvider": "GCP",
            "externalId": "innovation-portfolio-hmjd",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "us-west1",
          "regionLocation": "US",
          "tags": null,
          "projects": [
            {
              "id": "118b4659-51ac-5fd6-97ac-99deb051f08f",
              "name": "provisioning-CE-INNOVATION",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "deb2ab55-2b14-5a11-92d1-e2259a5f4635",
              "name": "CE-INNOVATION",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-20T09:08:57.929553Z",
          "updatedAt": "2026-06-24T23:18:24.817033Z",
          "deletedAt": null,
          "firstSeen": "2026-05-20T17:30:08.412639Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "1375cafc-b36e-53fc-be22-efb0e107c089",
          "name": "supervisor-agent-ssa-dev",
          "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/3075369207261560832",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "1375cafc-b36e-53fc-be22-efb0e107c089",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/3075369207261560832",
            "properties": {
              "_productIDs": [
                "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "295fbc80-2563-5f6a-8ced-88fe9761ef95"
              ],
              "_vertexID": "1375cafc-b36e-53fc-be22-efb0e107c089",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/3075369207261560832?project=tst4-slf-analytics-zouu",
              "configPath": null,
              "creationDate": "2026-05-09T13:52:05.201434Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/3075369207261560832",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "supervisor-agent-ssa-dev",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/3075369207261560832",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "tst4-slf-analytics-zouu",
              "updatedAt": "2026-06-25T00:17:50Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "supervisor-agent-ssa-dev",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b8871f3a-312f-5245-9dd5-77f4ebc17464",
            "name": "tst4-slf-analytics-zouu",
            "cloudProvider": "GCP",
            "externalId": "tst4-slf-analytics-zouu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
              "name": "provisioning-CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "295fbc80-2563-5f6a-8ced-88fe9761ef95",
              "name": "CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-09T13:52:05.201434Z",
          "updatedAt": "2026-06-25T00:17:50.551542Z",
          "deletedAt": null,
          "firstSeen": "2026-05-09T22:00:56.515917Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "3e34b804-3e90-573e-a457-fb306a40d341",
          "name": "supervisor-agent-ssa",
          "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/6233518445955121152",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "3e34b804-3e90-573e-a457-fb306a40d341",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/6233518445955121152",
            "properties": {
              "_productIDs": [
                "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "295fbc80-2563-5f6a-8ced-88fe9761ef95"
              ],
              "_vertexID": "3e34b804-3e90-573e-a457-fb306a40d341",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/6233518445955121152?project=tst4-slf-analytics-zouu",
              "configPath": null,
              "creationDate": "2026-05-08T09:00:37.597747Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/6233518445955121152",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "supervisor-agent-ssa",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/6233518445955121152",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "tst4-slf-analytics-zouu",
              "updatedAt": "2026-06-25T00:17:50Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "supervisor-agent-ssa",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b8871f3a-312f-5245-9dd5-77f4ebc17464",
            "name": "tst4-slf-analytics-zouu",
            "cloudProvider": "GCP",
            "externalId": "tst4-slf-analytics-zouu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
              "name": "provisioning-CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "295fbc80-2563-5f6a-8ced-88fe9761ef95",
              "name": "CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-08T09:00:37.597747Z",
          "updatedAt": "2026-06-25T00:17:50.967758Z",
          "deletedAt": null,
          "firstSeen": "2026-05-08T19:40:52.070675Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "1f7bea67-82d7-564d-9fab-1390865b05a4",
          "name": "supervisor-agent-ssa-test",
          "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/3463804675122266112",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "1f7bea67-82d7-564d-9fab-1390865b05a4",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/3463804675122266112",
            "properties": {
              "_productIDs": [
                "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "295fbc80-2563-5f6a-8ced-88fe9761ef95"
              ],
              "_vertexID": "1f7bea67-82d7-564d-9fab-1390865b05a4",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/3463804675122266112?project=tst4-slf-analytics-zouu",
              "configPath": null,
              "creationDate": "2026-05-08T13:31:38.877478Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/3463804675122266112",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "supervisor-agent-ssa-test",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/3463804675122266112",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "tst4-slf-analytics-zouu",
              "updatedAt": "2026-06-25T00:17:50Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "supervisor-agent-ssa-test",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b8871f3a-312f-5245-9dd5-77f4ebc17464",
            "name": "tst4-slf-analytics-zouu",
            "cloudProvider": "GCP",
            "externalId": "tst4-slf-analytics-zouu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
              "name": "provisioning-CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "295fbc80-2563-5f6a-8ced-88fe9761ef95",
              "name": "CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-08T13:31:38.877478Z",
          "updatedAt": "2026-06-25T00:17:50.976325Z",
          "deletedAt": null,
          "firstSeen": "2026-05-08T19:40:51.554811Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        },
        {
          "id": "cd0c70a1-ded5-5578-a1fe-1cc90f208057",
          "name": "test-supervisor-agent-ssa",
          "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/7421624322650800128",
          "type": "AI_AGENT",
          "codeToCloudPipelineStage": "CLOUD",
          "isAvailableOnGraph": true,
          "graphEntity": {
            "id": "cd0c70a1-ded5-5578-a1fe-1cc90f208057",
            "type": "AI_AGENT",
            "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/7421624322650800128",
            "properties": {
              "_productIDs": [
                "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
                "1dfea0cf-834f-5522-b797-bee5aaf09251",
                "295fbc80-2563-5f6a-8ced-88fe9761ef95"
              ],
              "_vertexID": "cd0c70a1-ded5-5578-a1fe-1cc90f208057",
              "accessibleFrom.VPN": false,
              "accessibleFrom.internet": false,
              "accessibleFrom.otherSubscriptions": false,
              "accessibleFrom.otherVnets": false,
              "cloudPlatform": "GCP",
              "cloudProviderURL": "https://console.cloud.google.com/vertex-ai/generative/reasoning-engines/locations/europe-west1/reasoning-engines/7421624322650800128?project=tst4-slf-analytics-zouu",
              "configPath": null,
              "creationDate": "2026-05-07T18:55:20.586196Z",
              "dataAccessReasoning": null,
              "deploymentType": "DeploymentTypePaaS",
              "directory": null,
              "discoveryMethods": "MethodCloudScanning",
              "executablePath": null,
              "externalId": "projects/613131079245/locations/europe-west1/reasoningEngines/7421624322650800128",
              "fullResourceName": null,
              "installationMethod": null,
              "instructions": null,
              "maxExposureLevel": 0,
              "name": "test-supervisor-agent-ssa",
              "nativeType": "aiplatform#ReasoningEngine",
              "numAddressesOpenForHTTP": 0,
              "numAddressesOpenForHTTPS": 0,
              "numAddressesOpenForNonStandardPorts": 0,
              "numAddressesOpenForRDP": 0,
              "numAddressesOpenForSSH": 0,
              "numAddressesOpenForWINRM": 0,
              "openToAllInternet": false,
              "providerUniqueId": "projects/613131079245/locations/europe-west1/reasoningEngines/7421624322650800128",
              "publisher": null,
              "reasoning": null,
              "region": "europe-west1",
              "resourceGroupExternalId": null,
              "snippet": null,
              "status": "Active",
              "subscriptionExternalId": "tst4-slf-analytics-zouu",
              "updatedAt": "2026-06-25T00:17:51Z",
              "zone": null
            },
            "typedProperties": {
              "__typename": "GEAiAgent"
            },
            "name": "test-supervisor-agent-ssa",
            "technologies": [
              {
                "id": "13953",
                "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
                "__typename": "Technology"
              }
            ],
            "deletedAt": null,
            "userMetadata": null,
            "__typename": "GraphEntity"
          },
          "technology": {
            "id": "13953",
            "name": "GCP Vertex AI Agent",
            "icon": "https://assets.wiz.io/technology-icons/GCPProjectBillingInformation-f6e133bb-a5b8-4894-816b-499828f0b74e.svg",
            "description": "GCP Vertex AI Agent is a part of Google Cloud's Vertex AI platform, designed for building, deploying, and managing machine learning models. It provides tools for automating the machine learning lifecycle, including training, tuning, and deploying models at scale. Vertex AI Agent facilitates the integration of AI capabilities into applications with ease and efficiency.",
            "onlyServiceUsageSupported": false,
            "status": "UNDER_REVIEW",
            "businessModel": "COMMERCIAL_PROPRIETARY",
            "isBillableWorkload": false,
            "ownerHeadquartersCountryCode": "US",
            "ownerName": "Google LLC",
            "popularity": null,
            "deploymentModel": "CLOUD_PLATFORM_SERVICE",
            "stackLayer": "MACHINE_LEARNING_AND_AI",
            "categories": [
              {
                "id": "247",
                "name": "AI PaaS",
                "__typename": "TechnologyCategory"
              }
            ],
            "__typename": "Technology"
          },
          "cloudAccount": {
            "id": "b8871f3a-312f-5245-9dd5-77f4ebc17464",
            "name": "tst4-slf-analytics-zouu",
            "cloudProvider": "GCP",
            "externalId": "tst4-slf-analytics-zouu",
            "__typename": "CloudAccount"
          },
          "cloudPlatform": "GCP",
          "status": "Active",
          "region": "europe-west1",
          "regionLocation": "BE",
          "tags": null,
          "projects": [
            {
              "id": "13c84f0a-2fe0-525d-8c7b-379eadfc630f",
              "name": "provisioning-CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": false,
              "__typename": "Project"
            },
            {
              "id": "1dfea0cf-834f-5522-b797-bee5aaf09251",
              "name": "VALUE-CHAIN",
              "isFolder": true,
              "__typename": "Project"
            },
            {
              "id": "295fbc80-2563-5f6a-8ced-88fe9761ef95",
              "name": "CS-SUPPLY-CHAIN-SELF-ANALYTICS",
              "isFolder": true,
              "__typename": "Project"
            }
          ],
          "createdAt": "2026-05-07T18:55:20.586196Z",
          "updatedAt": "2026-06-25T00:17:51.406591Z",
          "deletedAt": null,
          "firstSeen": "2026-05-08T07:50:14.112154Z",
          "versionDetails": null,
          "typeFields": null,
          "resourceGroup": null,
          "isOpenToAllInternet": false,
          "isAccessibleFromInternet": false,
          "hasAccessToSensitiveData": null,
          "hasAdminPrivileges": null,
          "hasHighPrivileges": null,
          "hasSensitiveData": null,
          "hasPqcVulnerableTelemetry": null,
          "nativeType": "aiplatform#ReasoningEngine",
          "iacDetails": null,
          "iacVisibility": "NONE",
          "iacModuleSource": null,
          "owners": null,
          "__typename": "CloudResourceV2"
        }
      ],
      "__typename": "CloudResourceV2Connection"
    }
  }
}