import * as sourcegraph from 'sourcegraph'
import gql from 'tagged-template-noop'
import { queryGraphQL, rawQueryGraphQL } from './graphql'
import { isDefined, sortUnique } from './util'

/**
 * Retrieves the name of a repository. Throws an error if the repository
 * is not known to the Sourcegraph instance.
 *
 * @param cloneURL The repository's clone URL.
 */
export async function resolveRepo(cloneURL: string): Promise<string> {
    const query = gql`
        query ResolveRepo($cloneURL: String!) {
            repository(cloneURL: $cloneURL) {
                name
            }
        }
    `

    interface Response {
        repository: { name: string }
    }

    const data = await rawQueryGraphQL<Response>(query, { cloneURL })
    return data.repository.name
}

/**
 * Retrieves the revhash of an input rev for a repository. Throws an error if the
 * repository is not known to the Sourcegraph instance. Returns undefined if the
 * input rev is not known to the Sourcegraph instance.
 *
 * @param repoName The repository's name.
 * @param rev The revision.
 */
export async function resolveRev(
    repoName: string,
    rev: string
): Promise<string | undefined> {
    const query = gql`
        query ResolveRev($repoName: String!, $rev: String!) {
            repository(name: $repoName) {
                commit(rev: $rev) {
                    oid
                }
            }
        }
    `

    interface Response {
        repository: {
            commit?: {
                oid: string
            }
        }
    }

    const data = await rawQueryGraphQL<Response>(query, { repoName, rev })
    return data.repository.commit?.oid
}

/**
 * Retrieve a sorted and deduplicated list of repository names that contain the
 * given search query.
 *
 * @param searchQuery The input to the search function.
 */
export async function findReposViaSearch(
    searchQuery: string
): Promise<string[]> {
    const query = gql`
        query Search($query: String!) {
            search(query: $query) {
                results {
                    results {
                        ... on FileMatch {
                            repository {
                                name
                            }
                        }
                    }
                }
            }
        }
    `

    interface Response {
        search: {
            results: {
                results: {
                    // empty if not a FileMatch
                    repository?: { name: string }
                }[]
            }
        }
    }

    const data = await rawQueryGraphQL<Response>(query, { query: searchQuery })
    return sortUnique(
        data.search.results.results.map(r => r.repository?.name)
    ).filter(isDefined)
}

/**
 * Retrieve all raw manifests for every extension that exists in the Sourcegraph
 * extension registry.
 */
export async function getExtensionManifests(): Promise<string[]> {
    const query = gql`
        query ExtensionManifests {
            extensionRegistry {
                extensions {
                    nodes {
                        extensionID
                        manifest {
                            raw
                        }
                    }
                }
            }
        }
    `

    interface Response {
        extensionRegistry: {
            extensions: {
                nodes: {
                    manifest?: { raw: string }
                }[]
            }
        }
    }

    const data = await rawQueryGraphQL<Response>(query)
    return data.extensionRegistry.extensions.nodes
        .map(e => e.manifest?.raw)
        .filter(isDefined)
}

/**
 * Retrieve the version of the Sourcegraph instance.
 */
export async function productVersion(): Promise<string> {
    const query = gql`
        query ProductVersion {
            site {
                productVersion
            }
        }
    `

    interface Response {
        site: {
            productVersion: string
        }
    }

    const data = await rawQueryGraphQL<Response>(query)
    return data.site.productVersion
}

/**
 * Retrieve the identifier of the current user.
 *
 * Note: this method does not throw on an unauthenticated request.
 */
export async function getUser(): Promise<string | undefined> {
    const query = gql`
        query CurrentUser {
            currentUser {
                id
            }
        }
    `

    interface Response {
        currentUser?: { id: string }
    }

    const data = await rawQueryGraphQL<Response>(query)
    return data.currentUser?.id
}

/**
 * Creates a `user:all` scoped access token. Returns the newly created token.
 *
 * @param user The identifier of the user for which to create an access token.
 * @param note A note to attach to the access token.
 */
export async function createAccessToken(
    user: string,
    note: string
): Promise<string> {
    const query = gql`
        mutation CreateAccessToken(
            $user: ID!
            $note: String!
            $scopes: [String!]!
        ) {
            createAccessToken(user: $user, note: $note, scopes: $scopes) {
                token
            }
        }
    `

    interface Response {
        createAccessToken: {
            id: string
            token: string
        }
    }

    const data = await rawQueryGraphQL<Response>(query, {
        user,
        note,
        scopes: ['user:all'],
    })
    return data.createAccessToken.token
}

/**
 * Get the content of a file. Throws an error if the repository is not known to
 * the Sourcegraph instance. Returns undefined if the input rev or the file is
 * not known to the Sourcegraph instance.
 *
 * @param repo The repository in which the file exists.
 * @param rev The revision in which the target version of the file exists.
 * @param path The path of the file.
 */
export async function getFileContent(
    repo: string,
    rev: string,
    path: string
): Promise<string | undefined> {
    const query = gql`
        query FileContent($repo: String!, $rev: String!, $path: String!) {
            repository(name: $repo) {
                commit(rev: $rev) {
                    file(path: $path) {
                        content
                    }
                }
            }
        }
    `

    interface Response {
        repository: {
            commit?: {
                file?: { content: string }
            }
        }
    }

    const data = await rawQueryGraphQL<Response>(query, { repo, rev, path })
    return data.repository.commit?.file?.content
}

/**
 * A search result. Each result is for a particular repository and commit, but
 * may have many symbol or indexed/un-indexed search results.
 */
export interface SearchResult {
    file: {
        path: string
        commit: { oid: string }
    }
    repository: {
        name: string
    }
    symbols: SearchSymbol[]
    lineMatches: LineMatch[]
}

/**
 * A symbol search result.
 */
export interface SearchSymbol {
    name: string
    fileLocal: boolean
    kind: string
    location: {
        resource: { path: string }
        range?: sourcegraph.Range
    }
}

/**
 * An indexed or un-indexed search result.
 */
export interface LineMatch {
    lineNumber: number
    offsetAndLengths: [number, number][]
}

/**
 * Perform a search.
 *
 * @param searchQuery The input to the search command.
 * @param fileLocal Set to false to not request this field, which is absent in older versions of Sourcegraph.
 */
export async function search(
    searchQuery: string,
    fileLocal = true
): Promise<SearchResult[]> {
    const query = gql`
        query Search($query: String!) {
            search(query: $query) {
                results {
                    __typename
                        results {
                            ... on FileMatch {
                                __typename
                                file {
                                    path
                                    commit {
                                        oid
                                    }
                                }
                                repository {
                                    name
                                }
                                symbols {
                                    name
                                    ${fileLocal ? 'fileLocal' : ''}
                                    kind
                                    location {
                                        resource {
                                            path
                                        }
                                        range {
                                            start {
                                                line
                                                character
                                            }
                                            end {
                                                line
                                                character
                                            }
                                        }
                                    }
                                }
                                lineMatches {
                                    lineNumber
                                    offsetAndLengths
                                }
                        }
                    }
                }
            }
        }
    `

    interface Response {
        search: {
            results: {
                limitHit: boolean
                results: (SearchResult | undefined)[]
            }
        }
    }

    const data = await queryGraphQL<Response>(query, { query: searchQuery })
    return data.search.results.results.filter(isDefined)
}