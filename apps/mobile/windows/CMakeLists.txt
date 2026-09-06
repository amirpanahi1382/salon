# Project-level configuration.
cmake_minimum_required(VERSION 3.14)
project(salon_mobile LANGUAGES CXX)

# The name of the executable created for the application. Change this to change
# the on-disk name of your application.
set(BINARY_NAME "salon_mobile")

# Explicitly opt in to modern CMake behaviors to avoid warnings with recent
# versions of CMake.
cmake_policy(VERSION 3.14...3.25)

# Define build configuration option.
get_property(IS_MULTICONFIG GLOBAL PROPERTY GENERATOR_IS_MULTI_CONFIG)
if(IS_MULTICONFIG)
  set(CMAKE_CONFIGURATION_TYPES "Debug;Profile;Release"
    CACHE STRING "" FORCE)
else()
  if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
    set(CMAKE_BUILD_TYPE "Debug" CACHE
      STRING "Flutter build mode" FORCE)
    set_property(CACHE CMAKE_BUILD_TYPE PROPERTY STRINGS
      "Debug" "Profile" "Release")
  endif()
endif()
# Define settings for the Profile build mode.
set(CMAKE_EXE_LINKER_FLAGS_PROFILE "${CMAKE_EXE_LINKER_FLAGS_RELEASE}")
set(CMAKE_SHARED_LINKER_FLAGS_PROFILE "${CMAKE_SHARED_LINKER_FLAGS_RELEASE}")
set(CMAKE_C_FLAGS_PROFILE "${CMAKE_C_FLAGS_RELEASE}")
set(CMAKE_CXX_FLAGS_PROFILE "${CMAKE_CXX_FLAGS_RELEASE}")

# Use Unicode for all projects.
add_definitions(-DUNICODE -D_UNICODE)

# Compilation settings that should be applied to most targets.
#
# Be cautious about adding new options here, as plugins use this function by
# default. In most cases, you should add new options to specific targets instead
# of modifying this function.
function(APPLY_STANDARD_SETTINGS TARGET)
  target_compile_features(${TARGET} PUBLIC cxx_std_17)
  target_compile_options(${TARGET} PRIVATE /W4 /WX /wd"4100")
  target_compile_options(${TARGET} PRIVATE /EHsc)
  target_compile_definitions(${TARGET} PRIVATE "_HAS_EXCEPTIONS=0")
  target_compile_definitions(${TARGET} PRIVATE "$<$<CONFIG:Debug>:_DEBUG>")
endfunction()

# Flutter library and tool build rules.
set(FLUTTER_MANAGED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/flutter")
add_subdirectory(${FLUTTER_MANAGED_DIR})

# Application build; see runner/CMakeLists.txt.
add_subdirectory("runner")

# flutter_secure_storage_windows includes <atlstr.h>. Flutter selects the
# newest MSVC toolset (here 14.51 / v145), which may not include ATL even
# when an older toolset on the same Build Tools install does (14.44).
# Keep using flutter_secure_storage; expose ATL from any installed toolset.
set(_salon_atl_include "")
set(_salon_atls_lib "")
if(MSVC)
  set(_salon_atlstr "")
  if(DEFINED ENV{VCToolsInstallDir})
    set(_salon_atl_default "$ENV{VCToolsInstallDir}atlmfc/include/atlstr.h")
    if(EXISTS "${_salon_atl_default}")
      set(_salon_atlstr "${_salon_atl_default}")
    endif()
  endif()
  if(_salon_atlstr STREQUAL "")
    file(GLOB _salon_atl_hits
      "C:/Program Files (x86)/Microsoft Visual Studio/*/*/VC/Tools/MSVC/*/atlmfc/include/atlstr.h"
      "C:/Program Files/Microsoft Visual Studio/*/*/VC/Tools/MSVC/*/atlmfc/include/atlstr.h"
    )
    if(_salon_atl_hits)
      list(SORT _salon_atl_hits ORDER DESCENDING)
      list(GET _salon_atl_hits 0 _salon_atlstr)
    endif()
  endif()
  if(NOT _salon_atlstr STREQUAL "")
    get_filename_component(_salon_atl_include "${_salon_atlstr}" DIRECTORY)
    get_filename_component(_salon_atl_mfc "${_salon_atl_include}" DIRECTORY)
    if(CMAKE_SIZEOF_VOID_P EQUAL 8)
      set(_salon_atl_arch "x64")
    else()
      set(_salon_atl_arch "x86")
    endif()
    foreach(_salon_atls_candidate
      "${_salon_atl_mfc}/lib/${_salon_atl_arch}/atls.lib"
      "${_salon_atl_mfc}/lib/spectre/${_salon_atl_arch}/atls.lib")
      if(EXISTS "${_salon_atls_candidate}")
        set(_salon_atls_lib "${_salon_atls_candidate}")
        break()
      endif()
    endforeach()
    message(STATUS "ATL headers: ${_salon_atl_include}")
    if(_salon_atls_lib)
      message(STATUS "ATL library: ${_salon_atls_lib}")
    endif()
  else()
    message(WARNING "atlstr.h not found. Install 'C++ ATL for latest build tools' in Visual Studio Build Tools.")
  endif()
endif()

# Generated plugin build rules, which manage building the plugins and adding
# them to the application.
include(flutter/generated_plugins.cmake)

if(TARGET flutter_secure_storage_windows_plugin)
  if(_salon_atl_include)
    target_include_directories(flutter_secure_storage_windows_plugin PRIVATE
      "${_salon_atl_include}")
  endif()
  if(_salon_atls_lib)
    target_link_libraries(flutter_secure_storage_windows_plugin PRIVATE
      "${_salon_atls_lib}")
    # MSB8041 uses unquoted Exists($(ATL_KeyFile)); paths under
    # Program Files (x86) fail that check even when the file exists.
    set_property(TARGET flutter_secure_storage_windows_plugin PROPERTY
      VS_GLOBAL_CheckMSVCComponents "false")
  endif()
endif()


# === Installation ===
# Support files are copied into place next to the executable, so that it can
# run in place. This is done instead of making a separate bundle (as on Linux)
# so that building and running from within Visual Studio will work.
set(BUILD_BUNDLE_DIR "$<TARGET_FILE_DIR:${BINARY_NAME}>")
# Make the "install" step default, as it's required to run.
set(CMAKE_VS_INCLUDE_INSTALL_TO_DEFAULT_BUILD 1)
if(CMAKE_INSTALL_PREFIX_INITIALIZED_TO_DEFAULT)
  set(CMAKE_INSTALL_PREFIX "${BUILD_BUNDLE_DIR}" CACHE PATH "..." FORCE)
endif()

set(INSTALL_BUNDLE_DATA_DIR "${CMAKE_INSTALL_PREFIX}/data")
set(INSTALL_BUNDLE_LIB_DIR "${CMAKE_INSTALL_PREFIX}")

install(TARGETS ${BINARY_NAME} RUNTIME DESTINATION "${CMAKE_INSTALL_PREFIX}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_ICU_DATA_FILE}" DESTINATION "${INSTALL_BUNDLE_DATA_DIR}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_LIBRARY}" DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
  COMPONENT Runtime)

if(PLUGIN_BUNDLED_LIBRARIES)
  install(FILES "${PLUGIN_BUNDLED_LIBRARIES}"
    DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
    COMPONENT Runtime)
endif()

# Copy the native assets provided by the build.dart from all packages.
set(NATIVE_ASSETS_DIR "${PROJECT_BUILD_DIR}native_assets/windows/")
install(DIRECTORY "${NATIVE_ASSETS_DIR}"
   DESTINATION "${INSTALL_BUNDLE_LIB_DIR}"
   COMPONENT Runtime)

# Fully re-copy the assets directory on each build to avoid having stale files
# from a previous install.
set(FLUTTER_ASSET_DIR_NAME "flutter_assets")
install(CODE "
  file(REMOVE_RECURSE \"${INSTALL_BUNDLE_DATA_DIR}/${FLUTTER_ASSET_DIR_NAME}\")
  " COMPONENT Runtime)
install(DIRECTORY "${PROJECT_BUILD_DIR}/${FLUTTER_ASSET_DIR_NAME}"
  DESTINATION "${INSTALL_BUNDLE_DATA_DIR}" COMPONENT Runtime)

# Install the AOT library on non-Debug builds only.
install(FILES "${AOT_LIBRARY}" DESTINATION "${INSTALL_BUNDLE_DATA_DIR}"
  CONFIGURATIONS Profile;Release
  COMPONENT Runtime)
