FROM gradle:8.14.3-jdk21 AS build
WORKDIR /workspace
COPY . .
RUN gradle bootJar --no-daemon

FROM eclipse-temurin:21-jre
RUN useradd --system --uid 10001 apivoy
WORKDIR /app
COPY --from=build /workspace/build/libs/*.jar app.jar
RUN mkdir /app/data && chown -R apivoy /app
USER apivoy
EXPOSE 8088
ENTRYPOINT ["java","-jar","/app/app.jar"]
