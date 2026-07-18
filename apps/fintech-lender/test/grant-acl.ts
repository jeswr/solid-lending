/**
 * Test-only WAC ACL templates for the scene-3 grant (decision-0015-style
 * L4): a REAL access-control document naming exactly the service identity
 * the borrower's grant permits, mirroring `@lending/test-kit`'s own
 * `publicReadAcl` (which grants `foaf:Agent` instead of a specific WebID).
 */

/** A resource-scoped ACL: the owner keeps full control; `agentWebid` gets Read only. */
export function resourceGrantAcl(
  resourcePath: string,
  options: { ownerWebid: string; agentWebid: string },
): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${options.ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .

<#grant>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${options.agentWebid}> ;
    acl:mode acl:Read .
`;
}

/** A resource-scoped ACL with NO grant beyond the owner (revocation state). */
export function ownerOnlyAcl(resourcePath: string, ownerWebid: string): string {
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`;
}
