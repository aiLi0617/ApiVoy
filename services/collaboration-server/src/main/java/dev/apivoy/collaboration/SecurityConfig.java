package dev.apivoy.collaboration;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.context.annotation.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.web.cors.*;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.List;

@Configuration
class SecurityConfig {
    @Bean PasswordEncoder passwordEncoder() { return new BCryptPasswordEncoder(); }
    @Bean SecurityFilterChain security(HttpSecurity http, SessionRepository sessions) throws Exception {
        var filter = new OncePerRequestFilter() {
            @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
                String value = request.getHeader("Authorization");
                if (value != null && value.startsWith("Bearer ")) sessions.findByTokenHashAndRevokedAtIsNullAndExpiresAtAfter(hash(value.substring(7)), Instant.now()).ifPresent(session -> SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(session.userId, null, List.of())));
                chain.doFilter(request, response);
            }
        };
        return http.csrf(csrf -> csrf.disable()).cors(cors -> {}).sessionManagement(session -> session.sessionCreationPolicy(org.springframework.security.config.http.SessionCreationPolicy.STATELESS)).authorizeHttpRequests(auth -> auth.requestMatchers("/v1/auth/**", "/actuator/health").permitAll().anyRequest().authenticated()).addFilterBefore(filter, org.springframework.security.web.authentication.AnonymousAuthenticationFilter.class).build();
    }
    @Bean CorsConfigurationSource corsConfigurationSource(@Value("${apivoy.allowed-origins}") String origins) {
        var configuration = new CorsConfiguration();
        configuration.setAllowedOrigins(java.util.Arrays.stream(origins.split(",")).map(String::trim).filter(value -> !value.isEmpty()).toList());
        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-ApiVoy-Bootstrap-Token", "Last-Event-ID"));
        configuration.setExposedHeaders(List.of("X-ApiVoy-Revision"));
        configuration.setAllowCredentials(false);
        var source = new UrlBasedCorsConfigurationSource(); source.registerCorsConfiguration("/**", configuration); return source;
    }
    static String hash(String value) { try { return java.util.HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); } catch (Exception e) { throw new IllegalStateException(e); } }
}
