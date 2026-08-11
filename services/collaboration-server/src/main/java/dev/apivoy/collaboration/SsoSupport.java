package dev.apivoy.collaboration;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

@Component
@ConditionalOnProperty(name="apivoy.sso.enabled",havingValue="true")
class SsoSuccessHandler implements org.springframework.security.web.authentication.AuthenticationSuccessHandler {
    private final CollaborationService collaboration;
    private final ObjectMapper json;
    private final String organizationId;
    private final Role defaultRole;
    private final String webRedirect;

    SsoSuccessHandler(CollaborationService collaboration,ObjectMapper json,@Value("${apivoy.sso.organization-id}") String organizationId,@Value("${apivoy.sso.default-role:VIEWER}") Role defaultRole,@Value("${apivoy.sso.web-redirect}") String webRedirect){this.collaboration=collaboration;this.json=json;this.organizationId=organizationId;this.defaultRole=defaultRole;this.webRedirect=webRedirect;}

    @Override public void onAuthenticationSuccess(HttpServletRequest request,HttpServletResponse response,Authentication authentication)throws java.io.IOException {
        if(!(authentication instanceof OAuth2AuthenticationToken token)||!(token.getPrincipal() instanceof OidcUser user))throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"OIDC identity required");
        boolean verified=Boolean.TRUE.equals(user.getEmailVerified());
        String provider=user.getIssuer()==null?token.getAuthorizedClientRegistrationId():user.getIssuer().toString();
        var result=collaboration.ssoLogin(provider,user.getSubject(),user.getEmail(),verified,user.getFullName(),organizationId,defaultRole,request.getHeader("User-Agent"));
        String payload=Base64.getUrlEncoder().withoutPadding().encodeToString(json.writeValueAsString(result).getBytes(StandardCharsets.UTF_8));
        response.sendRedirect(webRedirect.replaceAll("/+$","")+"#apivoy_sso="+payload);
    }
}

@RestController
@RequestMapping("/v1/auth/sso")
class SsoDiscoveryController {
    private final boolean enabled;
    private final String registrationId;
    SsoDiscoveryController(@Value("${apivoy.sso.enabled:false}") boolean enabled){this.enabled=enabled;this.registrationId="oidc";}
    @GetMapping("/config") SsoConfig config(){return new SsoConfig(enabled,enabled?"/oauth2/authorization/"+registrationId:null);}
    record SsoConfig(boolean enabled,String loginPath){}
}
