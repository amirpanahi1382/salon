allprojects {
    repositories {
        mavenLocal()
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Flutter's template compileSdk is 36. Some plugins request API 37, which this
// SDK records as 37.0 and AGP 9 cannot resolve. Pin library modules to 36.
subprojects {
    pluginManager.withPlugin("com.android.library") {
        val components = extensions.getByName("androidComponents")
        val finalize =
            components.javaClass.methods.first {
                it.name == "finalizeDsl" &&
                    it.parameterCount == 1 &&
                    Action::class.java.isAssignableFrom(it.parameterTypes[0])
            }
        finalize.invoke(
            components,
            object : Action<Any> {
                override fun execute(dsl: Any) {
                    val setter =
                        dsl.javaClass.methods.first {
                            it.name == "setCompileSdk" && it.parameterCount == 1
                        }
                    setter.invoke(dsl, 36)
                }
            },
        )
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
