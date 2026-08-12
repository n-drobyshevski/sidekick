"""
# Python 3.9+
pip(3) install requests
"""
import base64
import json
import requests

# Standard headers
HEADERS_AUTH = {"Content-Type": "application/x-www-form-urlencoded"}
HEADERS = {"Content-Type": "application/json"}

CLIENT_ID = "SERVICE_ACCOUNT_CLIENT_ID"
CLIENT_SECRET = "SERVICE_ACCOUNT_CLIENT_SECRET"

# Uncomment the following section to define the proxies in your environment,
#   if necessary:
# http_proxy  = "http://"+user+":"+passw+"@x.x.x.x:abcd"
# https_proxy = "https://"+user+":"+passw+"@y.y.y.y:abcd"
# proxyDict = {
#     "http"  : http_proxy,
#     "https" : https_proxy
# }

# The GraphQL query that defines which data you wish to fetch.
QUERY = """
    query SASTFindingsTable($filterBy: SASTFindingFilters, $first: Int, $after: String, $orderBy: SASTFindingOrder, $fetchTotalCount: Boolean = true, $fetchAiAnalysis: Boolean = false) {
      sastFindings(
        filterBy: $filterBy
        first: $first
        after: $after
        orderBy: $orderBy
      ) {
        nodes {
          id
          name
          status
          resource {
            id
            name
            type
          }
          filePath
          startLine
          severity
          originalSeverity
          codeLibraryLanguage
          origin
          impact
          likelihood
          vcsDetails {
            commitHash
          }
          projects {
            id
            name
            isFolder
            slug
          }
          weaknesses {
            id
            name
          }
          resolutionReason
          aiAnalysis @include(if: $fetchAiAnalysis) {
            verdict
          }
          isAiPowered
        }
        totalCount @include(if: $fetchTotalCount)
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
"""

# The variables sent along with the above query
VARIABLES = {
  "fetchTotalCount": True,
  "fetchAiAnalysis": True,
  "first": 40,
  "filterBy": {
    "projectId": [
      "1dfea0cf-834f-5522-b797-bee5aaf09251"
    ],
    "resource": {
      "isDefaultBranch": {
        "equals": True
      }
    }
  },
  "orderBy": {
    "field": "SEVERITY",
    "direction": "DESC"
  }
}


def query_wiz_api(query, variables, dc):
    """Query Wiz API for the given query data schema"""

    data = {"variables": variables, "query": query}

    try:
        # Uncomment the next first line and comment the line after that
        # to run behind proxies
        # result = requests.post(url=f"https://api.{dc}.app.wiz.io/graphql",
        #                        json=data, headers=HEADERS, proxies=proxyDict, timeout=180)
        result = requests.post(url=f"https://api.{dc}.app.wiz.io/graphql",
                               json=data, headers=HEADERS, timeout=180)

    except requests.exceptions.HTTPError as e:
        print(f"<p>Wiz-API-Error (4xx/5xx): {str(e)}</p>")
        return e

    except requests.exceptions.ConnectionError as e:
        print(f"<p>Network problem (DNS failure, refused connection, etc): {str(e)}</p>")
        return e

    except requests.exceptions.Timeout as e:
        print(f"<p>Request timed out: {str(e)}</p>")
        return e

    return result.json()


def request_wiz_api_token(client_id, client_secret):
    """Retrieve an OAuth access token to be used against Wiz API"""

    auth_payload = {
      'grant_type': 'client_credentials',
      'audience': 'wiz-api',
      'client_id': client_id,
      'client_secret': client_secret
    }
    try:
        # Uncomment the next first line and comment the line after that
        # to run behind proxies
        # response = requests.post(url="https://auth.app.wiz.io/oauth/token",
        #                         headers=HEADERS_AUTH, data=auth_payload,
        #                         proxies=proxyDict, timeout=180)
        response = requests.post(url="https://auth.app.wiz.io/oauth/token",
                                headers=HEADERS_AUTH, data=auth_payload, timeout=180)

    except requests.exceptions.HTTPError as e:
        print(f"<p>Error authenticating to Wiz (4xx/5xx): {str(e)}</p>")
        return e

    except requests.exceptions.ConnectionError as e:
        print(f"<p>Network problem (DNS failure, refused connection, etc): {str(e)}</p>")
        return e

    except requests.exceptions.Timeout as e:
        print(f"<p>Request timed out: {str(e)}</p>")
        return e

    try:
        response_json = response.json()
        token = response_json.get('access_token')
        if not token:
            message = f"Could not retrieve token from Wiz: {response_json.get('message')}"
            raise ValueError(message)
    except ValueError as exception:
        message = f"Could not parse API response {exception}. Check Service Account details " \
                    "and variables"
        raise ValueError(message) from exception

    response_json_decoded = json.loads(
        base64.standard_b64decode(pad_base64(token.split(".")[1]))
    )
    dc = response_json_decoded["dc"]
    return token, dc


def pad_base64(data):
    """Makes sure base64 data is padded"""
    missing_padding = len(data) % 4
    if missing_padding != 0:
        data += "=" * (4 - missing_padding)
    return data


def main():
    """Main function"""

    print("Getting token.")
    token, dc = request_wiz_api_token(CLIENT_ID, CLIENT_SECRET)
    HEADERS["Authorization"] = "Bearer " + token

    result = query_wiz_api(QUERY, VARIABLES, dc)
    print(result)  # your data is here!

    # The above code lists the first <x> items.
    # If paginating on a Graph Query,
    #   then use <'quick': False> in the query variables.
    # Uncomment the following section to paginate over all the results:
    # pageInfo = result['data']['sastFindings']['pageInfo']
    # while (pageInfo['hasNextPage']):
    #     # fetch next page
    #     VARIABLES['after'] = pageInfo['endCursor']
    #     result = query_wiz_api(QUERY, VARIABLES, dc)
    #     print(result)
    #     pageInfo = result['data']['sastFindings']['pageInfo']


if __name__ == '__main__':
    main()

